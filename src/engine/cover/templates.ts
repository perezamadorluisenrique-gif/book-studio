// Twenty ready-made covers: eight free, twelve Pro. Each is a function from the
// book's texts and the cover geometry to a layered CoverDesign, so it fits any
// trim size and any spine thickness. Every colour pair was picked for contrast
// (the tests check 4.5 to 1 for each text layer against everything under it).

import type { Book } from "../model";
import type { CoverBackground, CoverDesign, CoverLayer, GenFamily, TextLayer } from "./design";
import { SAFE, SPINE_SAFE, type CoverGeometry } from "./geometry";

/** What a template needs from a book. */
export interface CoverInfo {
  title: string;
  subtitle?: string;
  authors: string[];
  language: string;
  tagline?: string;
  blurb: string[];
  bio: string[];
  /** The book's front cover picture, if it has one; picture templates use it. */
  coverTarget?: string;
  coverAlt?: string;
  spineTitle?: string;
  /** Which variant of a generative background (1, 2, 3…). */
  variant: number;
}

export function coverInfo(book: Pick<Book, "meta">, variant = 1): CoverInfo {
  const { meta } = book;
  return {
    title: meta.title,
    subtitle: meta.subtitle,
    authors: meta.authors,
    language: meta.language,
    tagline: meta.coverDesign.tagline,
    blurb: meta.coverDesign.blurb,
    bio: meta.coverDesign.bio,
    coverTarget: meta.cover?.target,
    coverAlt: meta.cover?.alt,
    spineTitle: meta.coverDesign.spineTitle,
    variant,
  };
}

export type FrontLayout = "center" | "top" | "bottom" | "bar" | "framed" | "band" | "split" | "photo-band" | "photo-card";

interface Look {
  background: (seed: string) => CoverBackground;
  ink: string;
  accent: string;
  /** Block colour for the layouts that use one (band, split, photo card, bar). */
  block?: string;
  blockInk?: string;
  layout: FrontLayout;
  title: string;
  bold?: boolean;
  italic?: boolean;
  upper?: boolean;
  body: string;
}

export interface CoverTemplate {
  id: string;
  name: string;
  nameEs: string;
  pro: boolean;
  /** The background family, for templates built on one. */
  generative?: GenFamily;
  build(info: CoverInfo, g: CoverGeometry): CoverDesign;
}

const solid = (color: string) => (): CoverBackground => ({ kind: "color", color });
const gradient = (from: string, to: string, angle = 90) => (): CoverBackground => ({ kind: "gradient", color: from, to, angle });
const pattern = (family: GenFamily, color: string, palette: string[]) => (seed: string): CoverBackground => ({ kind: "generative", color, family, seed, palette });

let counter = 0;
function text(panel: TextLayer["panel"], x: number, y: number, w: number, h: number, t: string, o: Partial<TextLayer> & Pick<TextLayer, "family" | "size" | "color">): TextLayer {
  return { id: `t${++counter}`, kind: "text", panel, x, y, w, h, text: t, align: "center", valign: "top", ...o };
}
const rect = (panel: TextLayer["panel"], x: number, y: number, w: number, h: number, color: string, bleed = false): CoverLayer => ({ id: `r${++counter}`, kind: "rect", panel, x, y, w, h, color, bleed: bleed || undefined });

const joinAuthors = (info: CoverInfo) => info.authors.join(info.language.startsWith("es") ? " y " : " & ");

function frontLayers(look: Look, info: CoverInfo, g: CoverGeometry): CoverLayer[] {
  const out: CoverLayer[] = [];
  const W = g.trim.width * 72;
  const titleMax = Math.min(Math.max(W * 0.14, 26), 64);
  const author = joinAuthors(info);
  const title = look.upper ? info.title.toUpperCase() : info.title;
  const titleOf = (x: number, y: number, w: number, h: number, align: TextLayer["align"], valign: TextLayer["valign"], color: string) =>
    text("front", x, y, w, h, title, { family: look.title, size: titleMax, minSize: 16, color, align, valign, bold: look.bold, italic: look.italic, lineHeight: 1.08 });
  const sub = (x: number, y: number, w: number, h: number, align: TextLayer["align"], color: string) =>
    info.subtitle ? [text("front", x, y, w, h, info.subtitle, { family: look.body, size: titleMax * 0.36, minSize: 10, color, align, italic: true, lineHeight: 1.2 })] : [];
  const by = (x: number, y: number, w: number, h: number, align: TextLayer["align"], valign: TextLayer["valign"], color: string) =>
    author ? [text("front", x, y, w, h, author, { family: look.body, size: titleMax * 0.4, minSize: 10, color, align, valign, uppercase: look.upper || undefined, tracking: look.upper ? 0.12 : 0.04, lineHeight: 1.2 })] : [];

  switch (look.layout) {
    case "center":
      out.push(titleOf(0.1, 0.18, 0.8, 0.34, "center", "bottom", look.ink), rect("front", 0.35, 0.545, 0.3, 0.004, look.accent), ...sub(0.12, 0.575, 0.76, 0.12, "center", look.ink), ...by(0.1, 0.85, 0.8, 0.09, "center", "bottom", look.ink));
      break;
    case "top":
      out.push(titleOf(0.1, 0.07, 0.8, 0.36, "left", "top", look.ink), rect("front", 0.1, 0.445, 0.18, 0.006, look.accent), ...sub(0.1, 0.47, 0.8, 0.12, "left", look.ink), ...by(0.1, 0.84, 0.8, 0.1, "left", "bottom", look.ink));
      break;
    case "bottom":
      out.push(...by(0.1, 0.06, 0.8, 0.07, "center", "top", look.ink), rect("front", 0.1, 0.52, 0.8, 0.004, look.accent), titleOf(0.1, 0.54, 0.8, 0.34, "center", "top", look.ink), ...sub(0.12, 0.89, 0.76, 0.07, "center", look.ink));
      break;
    case "bar":
      out.push(rect("front", 0, 0, 0.055, 1, look.block ?? look.accent, true), titleOf(0.14, 0.12, 0.76, 0.4, "left", "top", look.ink), ...sub(0.14, 0.54, 0.76, 0.12, "left", look.ink), ...by(0.14, 0.84, 0.76, 0.1, "left", "bottom", look.ink));
      break;
    case "framed": {
      const t = 0.004;
      out.push(rect("front", 0.07, 0.05, 0.86, t, look.accent), rect("front", 0.07, 0.95 - t, 0.86, t, look.accent), rect("front", 0.07, 0.05, t * 1.6, 0.9, look.accent), rect("front", 0.93 - t * 1.6, 0.05, t * 1.6, 0.9, look.accent));
      out.push(titleOf(0.14, 0.2, 0.72, 0.34, "center", "bottom", look.ink), ...sub(0.16, 0.57, 0.68, 0.12, "center", look.ink), ...by(0.14, 0.8, 0.72, 0.09, "center", "bottom", look.ink));
      break;
    }
    case "band": {
      const bandInk = look.blockInk ?? look.ink;
      out.push(rect("front", 0, 0.6, 1, 0.4, look.block ?? look.accent, true), ...by(0.1, 0.07, 0.8, 0.09, "left", "top", look.ink), titleOf(0.1, 0.63, 0.8, 0.26, "left", "top", bandInk), ...sub(0.1, 0.89, 0.8, 0.07, "left", bandInk));
      break;
    }
    case "split": {
      const topInk = look.blockInk ?? look.ink;
      out.push(rect("front", 0, 0, 1, 0.55, look.block ?? look.accent, true), titleOf(0.1, 0.1, 0.8, 0.4, "left", "bottom", topInk), ...sub(0.1, 0.6, 0.8, 0.1, "left", look.ink), ...by(0.1, 0.84, 0.8, 0.1, "left", "bottom", look.ink));
      break;
    }
    case "photo-band": {
      const bandInk = look.blockInk ?? look.ink;
      if (info.coverTarget) out.push({ id: `i${++counter}`, kind: "image", panel: "front", x: 0, y: 0, w: 1, h: 0.62, target: info.coverTarget, alt: info.coverAlt ?? "", fit: "cover", bleed: true });
      out.push(rect("front", 0, 0.62, 1, 0.38, look.block ?? look.accent, true), titleOf(0.1, 0.65, 0.8, 0.2, "left", "top", bandInk), ...by(0.1, 0.87, 0.8, 0.08, "left", "bottom", bandInk));
      break;
    }
    case "photo-card": {
      const cardInk = look.blockInk ?? look.ink;
      if (info.coverTarget) out.push({ id: `i${++counter}`, kind: "image", panel: "front", x: 0, y: 0, w: 1, h: 1, target: info.coverTarget, alt: info.coverAlt ?? "", fit: "cover", bleed: true });
      out.push(rect("front", 0.07, 0.62, 0.86, 0.3, look.block ?? look.accent), titleOf(0.1, 0.64, 0.8, 0.17, "center", "middle", cardInk), ...by(0.1, 0.82, 0.8, 0.08, "center", "middle", cardInk));
      break;
    }
  }
  return out;
}

function spineLayers(look: Look, info: CoverInfo, g: CoverGeometry): CoverLayer[] {
  if (!g.spineText) return [];
  // Across the spine, between its safe margins, with a hair of room.
  const x = (SPINE_SAFE + 0.004) / g.spine;
  const w = 1 - 2 * x;
  const thick = (g.spine - 2 * SPINE_SAFE) * 72;
  const size = Math.max(Math.min(thick * 0.8, 26), 5);
  const common = { family: look.title, size, minSize: 4, color: look.ink, valign: "middle" as const, rotate: true, lineHeight: 1, bold: look.bold, italic: look.italic };
  const title = look.upper ? (info.spineTitle ?? info.title).toUpperCase() : (info.spineTitle ?? info.title);
  const out: CoverLayer[] = [text("spine", x, 0.08, w, 0.56, title, { ...common, align: "left" })];
  const author = joinAuthors(info);
  if (author) out.push(text("spine", x, 0.68, w, 0.24, author, { ...common, family: look.body, bold: undefined, italic: undefined, size: size * 0.8, align: "right" }));
  return out;
}

function backLayers(look: Look, info: CoverInfo, g: CoverGeometry): CoverLayer[] {
  const out: CoverLayer[] = [];
  const barTop = (g.barcode.y - g.back.y) / g.back.h;
  const barLeft = (g.barcode.x - g.back.x) / g.back.w;
  const inkOnBack = look.ink;
  let y = 0.09;
  if (info.tagline) {
    out.push(text("back", 0.1, y, 0.8, 0.09, info.tagline, { family: look.body, size: 15, minSize: 9, color: inkOnBack, align: "left", italic: true }));
    y += 0.11;
  }
  if (info.blurb.length) {
    const bioRoom = info.bio.length ? 0.2 : 0.05;
    out.push(text("back", 0.1, y, 0.8, Math.max(barTop - bioRoom - y, 0.2), info.blurb.join("\n\n"), { family: look.body, size: 12, minSize: 8, color: inkOnBack, align: "left", lineHeight: 1.35 }));
  }
  if (info.bio.length) {
    const top = barTop - 0.02;
    const bottom = 1 - SAFE / g.back.h - 0.01;
    out.push(text("back", 0.1, top, Math.max(barLeft - 0.14, 0.3), bottom - top, info.bio.join("\n"), { family: look.body, size: 9, minSize: 7, color: inkOnBack, align: "left", valign: "bottom", lineHeight: 1.3 }));
  }
  return out;
}

function make(id: string, name: string, nameEs: string, pro: boolean, look: Look, generative?: GenFamily): CoverTemplate {
  return {
    id,
    name,
    nameEs,
    pro,
    generative,
    build(info, g) {
      counter = 0;
      const seed = `${info.title}|${info.authors.join(",")}|${info.variant}`;
      return { version: 1, template: id, background: look.background(seed), layers: [...frontLayers(look, info, g), ...spineLayers(look, info, g), ...backLayers(look, info, g)] };
    },
  };
}

const WHITE = "#ffffff";

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
  // ── Pro ──
  make("stripes-ink", "Ink stripes", "Franjas de tinta", true, { background: pattern("stripes", "#101a30", ["#1a2a4d", "#223a69", "#16233f"]), ink: WHITE, accent: "#e0b84c", layout: "center", title: "montserrat", bold: true, upper: true, body: "montserrat" }, "stripes"),
  make("rings-sun", "Rings", "Anillos", true, { background: pattern("circles", "#14213d", ["#1b2d52", "#22386a", "#1a3059"]), ink: WHITE, accent: "#fca311", layout: "top", title: "cormorant", bold: true, body: "eb-garamond" }, "circles"),
  make("facets-teal", "Teal facets", "Facetas turquesa", true, { background: pattern("triangles", "#0b3c49", ["#0f5a6e", "#0d4a5c", "#14717f", "#0b3c49"]), ink: WHITE, accent: "#ffd166", layout: "bottom", title: "montserrat", bold: true, body: "montserrat" }, "triangles"),
  make("waves-ocean", "Ocean waves", "Olas", true, { background: pattern("waves", "#0a2342", ["#12375f", "#1a4a7a", "#0f2d52"]), ink: WHITE, accent: "#9bd1ff", layout: "center", title: "cormorant", bold: true, body: "eb-garamond" }, "waves"),
  make("blocks-modern", "Colour blocks", "Bloques de color", true, { background: pattern("blocks", "#1a1a1a", ["#2a2a2a", "#3a3a3a", "#7f1d1d", "#1f2937"]), ink: WHITE, accent: "#f97316", layout: "top", title: "montserrat", bold: true, upper: true, body: "montserrat" }, "blocks"),
  make("constellation", "Constellation", "Constelación", true, { background: pattern("constellation", "#0b1026", ["#3b4a8f", "#51609f", "#2c3a78"]), ink: WHITE, accent: "#a5b4fc", layout: "center", title: "cormorant", bold: true, body: "eb-garamond" }, "constellation"),
  make("sunset", "Sunset", "Atardecer", true, { background: gradient("#3b0a45", "#8e1b3a"), ink: WHITE, accent: "#fbbf24", layout: "bottom", title: "cormorant", bold: true, italic: true, body: "eb-garamond" }),
  make("forest", "Forest", "Bosque", true, { background: gradient("#052e16", "#166534", 60), ink: "#f0fdf4", accent: "#bbf7d0", layout: "framed", title: "crimson-pro", bold: true, body: "crimson-pro" }),
  make("picture-card", "Picture with card", "Imagen con tarjeta", true, { background: solid("#1c1c1c"), ink: WHITE, accent: "#1c1c1c", block: "#111827", blockInk: WHITE, layout: "photo-card", title: "cormorant", bold: true, body: "eb-garamond" }),
  make("split-ink", "Split", "Mitad y mitad", true, { background: solid("#f6f1e7"), ink: "#1c1c1c", accent: "#b91c1c", block: "#b91c1c", blockInk: WHITE, layout: "split", title: "montserrat", bold: true, body: "montserrat" }),
  make("gold-bar", "Gold bar", "Barra dorada", true, { background: solid("#1f1f1f"), ink: "#f5f0e1", accent: "#c9a227", block: "#c9a227", layout: "bar", title: "eb-garamond", bold: true, body: "eb-garamond" }),
  make("stripes-sand", "Sand stripes", "Franjas de arena", true, { background: pattern("stripes", "#f3ead8", ["#e6d7b8", "#d9c59a", "#eddfc4"]), ink: "#1c1c1c", accent: "#7c2d12", layout: "bottom", title: "crimson-pro", bold: true, body: "crimson-pro" }, "stripes"),
];

export const FREE_COVER_TEMPLATES = COVER_TEMPLATES.filter((t) => !t.pro);

export function templateById(id: string): CoverTemplate | undefined {
  return COVER_TEMPLATES.find((t) => t.id === id);
}
