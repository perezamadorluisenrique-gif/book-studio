// The ready-made covers: eight free here, and the Pro ones from templates-pro.ts,
// which the public repository ships empty.

import { gradient, make, solid, WHITE, type CoverTemplate } from "./template-kit";
import { PRO_COVER_TEMPLATES } from "./templates-pro";

export { coverInfo, EBOOK_COVER, type CoverInfo, type CoverTemplate, type FrontLayout } from "./template-kit";

export const COVER_TEMPLATES: CoverTemplate[] = [
  // ── Free ──
  make("classic-navy", "Classic navy", "Clásica azul marino", false, { background: solid("#1b2a49"), ink: "#f4efe1", accent: "#c9a227", layout: "center", title: "cormorant", bold: true, body: "eb-garamond" }),
  make("classic-cream", "Classic cream", "Clásica crema", false, { background: solid("#f4eee0"), ink: "#1c1c1c", accent: "#8a2b2b", layout: "center", title: "eb-garamond", body: "eb-garamond" }),
  make("modern-bold", "Modern bold", "Moderna en negrita", false, { background: solid("#111827"), ink: WHITE, accent: "#f59e0b", layout: "top", title: "montserrat", bold: true, upper: true, body: "montserrat" }),
  make("clean-white", "Clean white", "Blanca limpia", false, { background: solid(WHITE), ink: "#111111", accent: "#2563eb", layout: "bottom", title: "montserrat", bold: true, body: "montserrat" }),
  make("red-band", "Red band", "Franja roja", false, { background: solid("#f5f5f0"), ink: "#1f1f1f", accent: "#9b1c1c", block: "#9b1c1c", blockInk: WHITE, layout: "band", title: "crimson-pro", bold: true, body: "crimson-pro" }),
  make("green-frame", "Green frame", "Marco verde", false, { background: solid("#0f3d2e"), ink: "#f3ead3", accent: "#d4b96a", layout: "framed", title: "cormorant", bold: true, body: "eb-garamond" }),
  make("dusk", "Dusk", "Anochecer", false, { background: gradient("#1e1b4b", "#4c1d95"), ink: WHITE, accent: "#c4b5fd", layout: "center", title: "cormorant", bold: true, body: "eb-garamond" }),
  make("picture-band", "Picture and band", "Imagen y franja", false, { background: solid("#1c1c1c"), ink: WHITE, accent: "#1c1c1c", block: "#1c1c1c", blockInk: WHITE, layout: "photo-band", title: "montserrat", bold: true, body: "montserrat" }),
  ...PRO_COVER_TEMPLATES,
];

export const FREE_COVER_TEMPLATES = COVER_TEMPLATES.filter((t) => !t.pro);

export function templateById(id: string): CoverTemplate | undefined {
  return COVER_TEMPLATES.find((t) => t.id === id);
}
