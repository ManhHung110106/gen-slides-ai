import { NextResponse } from "next/server";
import type { Deck } from "@/src/lib/deck";
import { normalizeDeck } from "@/src/lib/deck";

export const runtime = "nodejs";

// chỉ cho các model text (không có "image"/"vision")
const TEXT_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"] as const;
const PRIMARY_MODEL = "gemini-1.5-flash";
const FALLBACK_MODEL = "gemini-1.5-pro";

function sanitizeTextModel(m?: string) {
  const name = (m || "").toLowerCase();
  return (TEXT_MODELS as readonly string[]).includes(name) ? name : PRIMARY_MODEL;
}

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

function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)); }
function parseRetryDelaySeconds(txt:string){
  try {
    const o = JSON.parse(txt);
    const d = o?.error?.details?.find((x:any)=>String(x?.["@type"]||"").includes("RetryInfo"));
    if (d?.retryDelay) { const m = String(d.retryDelay).match(/(\d+)/); return m ? Number(m[1]) : null; }
  } catch {}
  return null;
}

async function callGemini(model: string, apiKey: string, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: deckSchema }
  };
  return fetch(url, { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) });
}

export async function POST(req: Request) {
  try {
    const { topic, slides = 6, lang = "vi", model } = await req.json();
    if (!topic) return NextResponse.json({ error: "Missing topic" }, { status: 400 });
    if (!process.env.GOOGLE_AI_STUDIO_API_KEY) return NextResponse.json({ error: "Missing GOOGLE_AI_STUDIO_API_KEY" }, { status: 500 });

    const count = Math.max(4, Math.min(slides, 10));
    const prompt = `Bạn là chuyên gia thiết kế slide.
Tạo ${count} slide cho chủ đề "${topic}" (ngôn ngữ: ${lang}).
Mỗi slide gồm:
- title: ngắn gọn
- bullets: 3–5 gạch đầu dòng, không trùng ý
- imagePrompt: mô tả ngắn bằng tiếng Anh để sinh ảnh minh hoạ (flat illustration, minimalist, 16:9)
Trả về JSON đúng schema.`;

    const tries = [sanitizeTextModel(model), sanitizeTextModel(model), FALLBACK_MODEL];
    let jsonText: string | undefined;

    for (let i = 0; i < tries.length; i++) {
      const m = tries[i];
      const res = await callGemini(m, process.env.GOOGLE_AI_STUDIO_API_KEY!, prompt);
      const txt = await res.text();

      if (res.ok) {
        const data = JSON.parse(txt);
        jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("Gemini returned no structured JSON.");
        break;
      }

      if (res.status === 400 && /JSON mode is not enabled/i.test(txt)) {
        // lỡ gửi model ảnh → ép về text model
        tries[i + 1] = PRIMARY_MODEL;
      } else if (res.status === 429 || res.status === 503) {
        const sec = parseRetryDelaySeconds(txt) ?? (0.8 * Math.pow(2, i));
        await sleep(sec * 1000);
        continue;
      } else {
        throw new Error(`Gemini ${res.status} on ${m}: ${txt}`);
      }
    }

    const deck: Deck = { topic, slides: JSON.parse(jsonText!).slides };
    return NextResponse.json(normalizeDeck(deck));
  } catch (e:any) {
    console.error("[/api/ai/generate] error:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}