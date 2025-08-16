export type Slide = {
  title: string;
  bullets: string[];
  imagePrompt?: string;
  imageUrl?: string;
  imageData?: string;
};
export type Deck  = { topic: string; slides: Slide[]; theme?: string; style?: "professional"|"casual" };

export function normalizeDeck(input: any): Deck {
  if (!input || typeof input !== "object") throw new Error("Deck invalid");
  const slidesIn = Array.isArray(input.slides) ? input.slides : [];
  const slides = slidesIn.filter((x:any)=>x && typeof x==="object").map((s:any,i:number)=>{
    const title = String(s?.title ?? `Slide ${i+1}`).trim() || `Slide ${i+1}`;
    let bullets: string[] = [];
    if (Array.isArray(s?.bullets)) bullets = s.bullets.map((x:any)=>String(x??"").trim()).filter(Boolean);
    if (!bullets.length && typeof s?.body === "string") bullets = s.body.split(/\r?\n/).map((x:string)=>x.trim()).filter(Boolean);
    while (bullets.length < 3) bullets.push("(điền ý)");
    return { title, bullets, imagePrompt: s?.imagePrompt };
  });
  if (!slides.length) throw new Error("Deck.slides empty");
  return { topic: String(input.topic ?? "Untitled"), slides, theme: input.theme, style: input.style ?? "professional" };
}