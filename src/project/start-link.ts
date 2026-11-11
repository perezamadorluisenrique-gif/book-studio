// Settings a link can carry into a new book (`?start=import&trim=6x9&paper=cream`), the way the free KDP
// calculators on the site hand over the size and paper they worked out. Only known values get through.

import { TRIMS } from "../engine/trims";

const PAPERS = ["white", "cream", "color"];

/** The layout settings named in a page address, or none when it names nothing valid. */
export function startSettings(search: string): Record<string, string> {
  const p = new URLSearchParams(search);
  const out: Record<string, string> = {};
  const trim = p.get("trim") ?? "";
  if (TRIMS.some((t) => t.id === trim)) out.trim = trim;
  const paper = p.get("paper") ?? "";
  if (PAPERS.includes(paper)) out.paper = paper;
  return out;
}
