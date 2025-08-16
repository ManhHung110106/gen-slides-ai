// src/app/api/images/generate/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";

const DEFAULT_IMAGE_MODEL = "imagen-3.0-fast-generate-001";

function sanitizeImageModel(m?: string) {
  const name = (m || "").toLowerCase();
  if (name === "imagen-4.0-generate-001") return name;
  return DEFAULT_IMAGE_MODEL;
}

async function generateImageDataUrl(prompt: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "16:9"
      // sampleImageSize: "1K" // nếu model hỗ trợ, có thể thêm
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GOOGLE_AI_STUDIO_API_KEY!,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const txt = await res.text();
  if (!res.ok) {
    // log chi tiết để debug
    console.error("[images/generate] status:", res.status, "body:", txt.slice(0, 800));
    throw new Error(`Imagen ${res.status}: ${txt}`);
  }

  const data = JSON.parse(txt);
  // đường đúng theo docs:
  const b64 =
    data?.generatedImages?.[0]?.image?.imageBytes ||
    data?.predictions?.[0]?.bytesBase64; // vài SDK/triển khai trả predictions

  if (!b64) throw new Error("Imagen returned no image bytes.");
  return `data:image/png;base64,${b64}`;
}

export async function POST(req: Request) {
  try {
    const { prompt, model } = await req.json();
    if (!prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    if (!process.env.GOOGLE_AI_STUDIO_API_KEY) {
      return NextResponse.json({ error: "Missing GOOGLE_AI_STUDIO_API_KEY" }, { status: 500 });
    }

    const dataUrl = await generateImageDataUrl(prompt, sanitizeImageModel(model));
    return NextResponse.json({ dataUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Image generation failed" }, { status: 500 });
  }
}