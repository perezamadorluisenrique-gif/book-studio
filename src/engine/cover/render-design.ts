// Draws a layered CoverDesign onto the flat cover sheet. Pure: it returns draws and
// findings, and never throws on a bad layer (a missing picture or text that does not
// fit becomes a finding the author can act on).

import type { ImageAsset } from "../model";
import { Styler, type RunStyle } from "../layout/style";
import type { Draw } from "../layout/types";
import type { CoverDesign, PanelId, TextLayer } from "./design";
import { SAFE, SPINE_SAFE, SPINE_TEXT_MIN_PAGES, type Box, type CoverGeometry } from "./geometry";
import { fitSize, hexToRgb, Painter, pt } from "./paint";

export interface DesignFinding {
  severity: "error" | "warning" | "info";
  message: string;
  /** The layer the finding is about, so an editor can point at it. */
  layer?: string;
}

export interface DesignContext {
  geometry: CoverGeometry;
  images: Map<string, ImageAsset>;
  styler: Styler;
}

const PT = 72;
const EDGE = 0.001;

export function panelBox(g: CoverGeometry, panel: PanelId): Box {
  return panel === "back" ? g.back : panel === "spine" ? g.spineBox : g.front;
}

/** The safe area of a panel, in inches: the part where text may sit. */
export function safeBox(g: CoverGeometry, panel: PanelId): Box {
  const b = panelBox(g, panel);
  if (panel === "spine") return { x: b.x + SPINE_SAFE, y: b.y + SAFE, w: Math.max(b.w - 2 * SPINE_SAFE, 0), h: b.h - 2 * SAFE };
  return { x: b.x + SAFE, y: b.y + SAFE, w: b.w - 2 * SAFE, h: b.h - 2 * SAFE };
}

/** A layer's box on the sheet, in inches; with `bleed` it runs into the bleed on the sides that touch the sheet's edge. */
export function layerBox(g: CoverGeometry, l: { panel: PanelId; x: number; y: number; w: number; h: number; bleed?: boolean }): Box {
  const p = panelBox(g, l.panel);
  let x1 = p.x + l.x * p.w;
  let y1 = p.y + l.y * p.h;
  let x2 = x1 + l.w * p.w;
  let y2 = y1 + l.h * p.h;
  if (l.bleed) {
    if (l.y <= EDGE) y1 = Math.min(y1, 0);
    if (l.y + l.h >= 1 - EDGE) y2 = Math.max(y2, g.height);
    if (l.panel === "back" && l.x <= EDGE) x1 = Math.min(x1, 0);
    if (l.panel === "front" && l.x + l.w >= 1 - EDGE) x2 = Math.max(x2, g.width);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const inside = (b: Box, s: Box) => b.x >= s.x - 0.002 && b.y >= s.y - 0.002 && b.x + b.w <= s.x + s.w + 0.002 && b.y + b.h <= s.y + s.h + 0.002;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawImage(draws: Draw[], img: ImageAsset, box: Box, fit: "cover" | "contain", alt: string): number {
  const bx = pt(box.x), by = pt(box.y), bw = pt(box.w), bh = pt(box.h);
  const scale = (fit === "cover" ? Math.max : Math.min)(bw / img.width, bh / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  draws.push({ kind: "image", x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h, path: img.path, alt, ...(fit === "cover" ? { clip: { x: bx, y: by, w: bw, h: bh } } : {}) });
  return PT / scale;
}

function runStyle(l: TextLayer, size: number): RunStyle {
  return { family: l.family, size, bold: l.bold, italic: l.italic, uppercase: l.uppercase, tracking: (l.tracking ?? 0) * size };
}

function drawText(p: Painter, l: TextLayer, box: Box, findings: DesignFinding[]): void {
  const lh = l.lineHeight ?? 1.2;
  const rotated = !!l.rotate;
  // Along the line (width) and across the lines (height) in the text's own frame.
  const along = pt(rotated ? box.h : box.w);
  const across = pt(rotated ? box.w : box.h);
  const paras = l.text.split(/\n/);
  const wrapped = (size: number) => paras.flatMap((t) => (t.trim() ? p.wrap(t, runStyle(l, size), along) : [""]));
  const fits = (size: number) => {
    const lines = wrapped(size);
    return lines.length * size * lh <= across + 0.01 && lines.every((s) => p.width(s, runStyle(l, size)) <= along + 0.01);
  };
  const fit = fitSize(l.size, Math.min(l.minSize ?? l.size, l.size), fits);
  const size = fit.size;
  const lines = wrapped(size);
  const style = runStyle(l, size);
  if (!fit.fits) findings.push({ severity: "warning", layer: l.id, message: `The text “${l.text.slice(0, 30)}${l.text.length > 30 ? "…" : ""}” does not fit its box on the ${l.panel} cover even at ${size} pt. Shorten it or make the box bigger.` });

  const blockH = lines.length * size * lh;
  const lead = l.valign === "middle" ? (across - blockH) / 2 : l.valign === "bottom" ? across - blockH : 0;
  lines.forEach((line, i) => {
    if (!line) return;
    const w = p.width(line, style);
    const off = l.align === "center" ? (along - w) / 2 : l.align === "right" ? along - w : 0;
    const mid = lead + (i + 0.5) * size * lh;
    const color = hexToRgb(l.color);
    if (rotated) {
      // Text reads top to bottom; the first line is the one nearest the right edge of the box.
      p.line(line, style, pt(box.x + box.w) - mid - size * 0.3, pt(box.y) + off, color, -90);
    } else {
      p.line(line, style, pt(box.x) + off, pt(box.y) + mid + size * 0.3, color);
    }
  });
}

export interface DesignResult {
  draws: Draw[];
  findings: DesignFinding[];
}

/** Draw the background and layers of `design`; the barcode box is the caller's. */
export function renderDesign(design: CoverDesign, ctx: DesignContext, ink: Painter): DesignResult {
  const { geometry: g, images } = ctx;
  const draws = ink.draws;
  const findings: DesignFinding[] = [];
  const W = pt(g.width);
  const H = pt(g.height);
  draws.push({ kind: "rect", x: 0, y: 0, w: W, h: H, fill: hexToRgb(design.background.color) });

  if (design.background.kind === "image") {
    const bg = design.background;
    const img = bg.path ? images.get(bg.path) : undefined;
    if (!img) findings.push({ severity: "warning", message: `The background picture ${bg.target} could not be read, so the cover has a plain background.` });
    else {
      const ppi = drawImage(draws, img, { x: 0, y: 0, w: g.width, h: g.height }, "cover", bg.alt);
      if (ppi < 300) findings.push({ severity: "warning", message: `The background picture prints at ${Math.round(ppi)} ppi; KDP asks for 300 ppi. Use one at least ${Math.ceil(g.width * 300)} × ${Math.ceil(g.height * 300)} pixels.` });
    }
  }

  let spineSkipped = false;
  for (const l of design.layers) {
    const box = layerBox(g, l);
    if (l.kind === "rect") {
      draws.push({ kind: "rect", x: pt(box.x), y: pt(box.y), w: pt(box.w), h: pt(box.h), fill: hexToRgb((l).color) });
    } else if (l.kind === "image") {
      const il = l;
      const img = il.path ? images.get(il.path) : undefined;
      if (!img) {
        findings.push({ severity: "warning", layer: l.id, message: `The picture ${il.target} on the ${l.panel} cover could not be read, so that layer is empty.` });
        continue;
      }
      const ppi = drawImage(draws, img, box, il.fit, il.alt);
      if (il.fit === "cover" && ppi < 300) findings.push({ severity: "warning", layer: l.id, message: `The picture ${il.target} prints at ${Math.round(ppi)} ppi on the ${l.panel} cover; KDP asks for 300 ppi.` });
    } else {
      const tl = l;
      if (!tl.text.trim()) continue;
      if (tl.panel === "spine" && !g.spineText) {
        if (!spineSkipped) findings.push({ severity: "info", message: `No text on the spine: KDP prints spine text only on books of ${SPINE_TEXT_MIN_PAGES} pages or more, and this one has ${g.pages}.` });
        spineSkipped = true;
        continue;
      }
      if (!inside(box, safeBox(g, tl.panel))) findings.push({ severity: "warning", layer: l.id, message: `The text “${tl.text.slice(0, 30)}${tl.text.length > 30 ? "…" : ""}” reaches outside the safe area of the ${tl.panel} cover, where the printer may trim it.` });
      if (tl.panel === "back" && overlaps(box, g.barcode)) findings.push({ severity: "warning", layer: l.id, message: `Text on the back cover runs into the barcode area (${tl.text.slice(0, 30)}…).` });
      drawText(ink, tl, box, findings);
    }
  }
  return { draws, findings };
}
