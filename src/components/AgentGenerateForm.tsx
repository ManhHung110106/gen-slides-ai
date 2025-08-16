"use client";

import { useState } from "react";
import type { Deck } from "@/src/lib/deck";

const TEXT_MODELS = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"] as const;
const IMAGE_MODELS = ["imagen-3.0-fast-generate-001", "imagen-4.0-generate-001"] as const;

export default function AgentGenerateForm() {
  const [topic, setTopic] = useState("Agentic AI trong giáo dục");
  const [slides, setSlides] = useState(6);
  const [textModel, setTextModel] = useState<(typeof TEXT_MODELS)[number]>("gemini-1.5-flash");
  const [imageModel, setImageModel] = useState<(typeof IMAGE_MODELS)[number]>("imagen-3.0-fast-generate-001");
  const [withImages, setWithImages] = useState(true); // bật/tắt sinh ảnh
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pptxUrl, setPptxUrl] = useState<string | null>(null);

  async function safeJson(res: Response) {
    const txt = await res.text();
    try {
      const json = JSON.parse(txt);
      if (!res.ok) throw new Error(json?.error || txt);
      return json;
    } catch {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
      throw new Error("Response is not valid JSON.");
    }
  }

  async function run() {
    try {
      setCreating(true);
      setErr(null);
      setPptxUrl(null);

      // 1) Gọi server text → sinh deck
      const deckRes = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          slides: Math.max(4, Math.min(slides, 10)),
          lang: "vi",
          model: textModel, // 👈 model text do người dùng chọn
        }),
      });
      const deck: Deck = await safeJson(deckRes);

      // 2) (Tuỳ chọn) tự sinh ảnh cho slide bìa ngay tại server export-pptx
      const pptxRes = await fetch("/api/export-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...deck,
          withImages,       // bật/tắt sinh ảnh
          imageModel,       // 👈 model ảnh do người dùng chọn
        }),
      });
      if (!pptxRes.ok) {
        const t = await pptxRes.text();
        throw new Error(`Export error: ${t.slice(0, 400)}`);
      }

      const blob = await pptxRes.blob();
      const url = URL.createObjectURL(blob);
      setPptxUrl(url);
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <label className="block text-sm font-medium">Chủ đề</label>
        <input
          className="border p-2 w-full"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="VD: Ứng dụng AI trong giáo dục"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Số slide (4–10)</label>
          <input
            type="number"
            min={4}
            max={10}
            className="border p-2 w-full"
            value={slides}
            onChange={(e) => setSlides(Number(e.target.value || 6))}
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Text model</label>
          <select
            className="border p-2 w-full"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value as any)}
          >
            {TEXT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Image model</label>
          <select
            className="border p-2 w-full"
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value as any)}
          >
            {IMAGE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex items-end">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={withImages}
              onChange={(e) => setWithImages(e.target.checked)}
            />
            <span>Sinh ảnh AI (slide bìa)</span>
          </label>
        </div>
      </div>

      <button
        onClick={run}
        disabled={creating}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-60"
      >
        {creating ? "Đang tạo..." : "Tạo & tải về .pptx"}
      </button>

      {err && <div className="text-red-600 text-sm whitespace-pre-wrap">{err}</div>}

      {pptxUrl && (
        <a
          href={pptxUrl}
          download="AI-deck.pptx"
          className="text-blue-600 underline block"
        >
          Tải PPTX
        </a>
      )}
    </div>
  );
}