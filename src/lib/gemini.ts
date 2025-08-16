import type { Deck } from "./deck";

/** chỉ dùng model TEXT (không có chữ image/vision) */
const TEXT_MODELS = ["gemini-1.5-flash","gemini-1.5-pro","gemini-2.0-flash"] as const;
const PRIMARY_MODEL  = "gemini-1.5-flash";
const FALLBACK_MODEL = "gemini-1.5-pro";

const deckSchema = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      minItems: 4, maxItems: 10,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
          imagePrompt: { type: "string" }
        },
        required: ["title","bullets"]
      }
    }
  },
  required: ["slides"]
} as const;

// cache 5'
type CacheKey = string;
const cache = new Map<CacheKey, { ts:number; deck: Deck }>();
const TTL = 5*60*1000;

const sanitize = (m?: string) => {
  const name = (m||"").toLowerCase();
  if (!TEXT_MODELS.includes(name as any)) return PRIMARY_MODEL;
  return name;
};

function keyOf(topic:string, count:number, lang:string, model:string){
  return `${model}|${lang}|${count}|${topic}`.toLowerCase();
}

function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)); }

function parseRetryDelaySeconds(errText:string){
  try {
    const o = JSON.parse(errText);
    const d = o?.error?.details?.find((x:any)=>String(x?.["@type"]||"").includes("RetryInfo"));
    if (d?.retryDelay) { const m = String(d.retryDelay).match(/(\d+)/); return m?Number(m[1]):null; }
  } catch {}
  return null;
}

async function callGemini(model:string, apiKey:string, prompt:string){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role:"user", parts:[{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: deckSchema }
  };
  return fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
}

/** Sinh deck (JSON-mode) */
export async function generateDeckWithGemini(topic:string, count=6, lang="vi", model=PRIMARY_MODEL): Promise<Deck> {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY!;
  const prompt = `Bạn là chuyên gia thiết kế slide.
Tạo ${count} slide cho chủ đề "${topic}" (ngôn ngữ: ${lang}).
Mỗi slide gồm:
- title: ngắn gọn
- bullets: 3–5 gạch đầu dòng, không trùng ý
- imagePrompt: mô tả ngắn bằng tiếng Anh để sinh ảnh minh hoạ (e.g. "Flat illustration, minimalist, 16:9")
Trả về JSON đúng schema.`;

  const modelSafe = sanitize(model);
  const k = keyOf(topic,count,lang,modelSafe);
  const hit = cache.get(k); if (hit && Date.now()-hit.ts<TTL) return hit.deck;

  const tries = [modelSafe, modelSafe, FALLBACK_MODEL];
  let jsonText:string|undefined;

  for (let i=0;i<tries.length;i++){
    const m = sanitize(tries[i]);
    const res = await callGemini(m, apiKey, prompt);
    if (res.ok){
      const data = await res.json();
      jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jsonText) throw new Error("Gemini returned no structured JSON text.");
      break;
    }
    const txt = await res.text();

    // nếu lỡ truyền sai model (image/vision) hoặc 400 “JSON mode not enabled”
    if (res.status===400 && /JSON mode is not enabled/i.test(txt)) { tries[i+1] = PRIMARY_MODEL; }

    if (res.status===429 || res.status===503){
      const sec = parseRetryDelaySeconds(txt) ?? (0.8*Math.pow(2,i));
      await sleep(sec*1000);
      continue;
    }
    throw new Error(`Gemini ${res.status} on ${m}: ${txt}`);
  }

  const parsed = JSON.parse(jsonText!);
  const deck: Deck = { topic, slides: parsed.slides };
  cache.set(k,{ ts: Date.now(), deck });
  return deck;
}