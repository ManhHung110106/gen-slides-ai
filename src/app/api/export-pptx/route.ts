import { NextResponse } from "next/server";
export const runtime = "nodejs";

type Slide = { title:string; bullets:string[]; imageUrl?:string; imageData?:string; imagePrompt?:string };
type Deck  = { topic:string; slides:Slide[]; withImages?:boolean; style?: "professional"|"casual" };

const PRIMARY_IMAGE_MODEL = process.env.IMAGEN_MODEL || "imagen-3.0-fast-generate-001";
const GEMINI_API_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY!;
const MAX_IMAGE_SLIDES = Number(process.env.MAX_IMAGE_SLIDES ?? 1);

// gọi Imagen qua AI Studio (v1beta/images:generate)
async function generateImageDataUrl(prompt:string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/images:generate`;
  const body = { model: PRIMARY_IMAGE_MODEL, prompt: { text: prompt }, size: "1024x576", aspectRatio:"16:9", n:1 };
  const res = await fetch(url, { method:"POST", headers:{ "x-goog-api-key":GEMINI_API_KEY, "Content-Type":"application/json" }, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Imagen ${res.status}: ${txt.slice(0,400)}`);
  const data = JSON.parse(txt);
  const b64 = data?.images?.[0]?.b64_data || data?.predictions?.[0]?.bytesBase64;
  if (!b64) throw new Error("Imagen returned no image bytes.");
  return `data:image/png;base64,${b64}`;
}

async function fetchAsDataUrl(url:string): Promise<string> {
  const r = await fetch(url, { cache:"no-store" });
  if (!r.ok) throw new Error(`Fetch image failed ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = /\.jpe?g($|\?)/i.test(url) ? "image/jpeg":"image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function POST(req: Request) {
  try {
    const deck = (await req.json()) as Deck;
    if (!deck?.slides?.length) return NextResponse.json({ error:"Deck.slides is empty" }, { status:400 });

    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();

    for (let i=0;i<deck.slides.length;i++){
      const s = deck.slides[i];
      const slide = pptx.addSlide();

      slide.addText(s.title||"Slide",{ x:0.5,y:0.5,w:8,h:0.8,bold:true,fontSize:28 });
      slide.addText((s.bullets||[]).map(t=>({text:String(t),options:{bullet:true}})),{ x:0.5,y:1.5,w:5.4,h:4.5,fontSize:18 });

      let dataUrl = s.imageData;

      // tạo ảnh bằng Imagen — mặc định chỉ slide bìa để tiết kiệm
      const shouldGen = !!deck.withImages && i < MAX_IMAGE_SLIDES;
      if (!dataUrl && shouldGen) {
        try {
          const auto = `${s.title}. ${s.bullets.slice(0,3).join(", ")}. modern flat illustration, minimalist, high quality, 16:9`;
          const prompt = (s.imagePrompt||"").trim() || auto;
          dataUrl = await generateImageDataUrl(prompt);
        } catch(e:any){
          console.error("[export-pptx] image gen error:", e?.message || e);
        }
      }

      if (!dataUrl && s.imageUrl) {
        try { dataUrl = await fetchAsDataUrl(s.imageUrl); } catch(e){ console.warn("image url fail",e); }
      }

      if (dataUrl) {
        slide.addImage({ data: dataUrl, x:6.1, y:1.5, w:3.5, h:4.5, sizing:{ type:"contain", w:3.5, h:4.5 } });
      }
    }

    const fileBuf: Buffer = await pptx.write("nodebuffer");
    return new NextResponse(fileBuf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="AI-deck.pptx"`,
        "Content-Length": String(fileBuf.byteLength),
        "Cache-Control": "no-store"
      }
    });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "Export PPTX failed" }, { status: 500 });
  }
}