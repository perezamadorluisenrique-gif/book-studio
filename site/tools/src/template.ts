// The cover template as a list of drawing steps in inches (origin top-left), drawn the same way
// into a PDF (pdf.ts) and into a canvas for the PNG (client.ts). Colours are RGB 0–1.

import { FIGURES, type CoverSize } from "./kdp";

export type Rgb = [number, number, number];
export type Op =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: Rgb; stroke?: Rgb; dash?: boolean }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Rgb; dash?: boolean }
  | { k: "text"; x: number; y: number; size: number; text: string; fill: Rgb; anchor?: "start" | "middle"; rotate?: boolean };

const RED: Rgb = [0.85, 0.15, 0.15];
const BLUE: Rgb = [0.15, 0.35, 0.8];
const GREEN: Rgb = [0.1, 0.55, 0.3];
const GREY: Rgb = [0.35, 0.35, 0.38];
const PINK: Rgb = [1, 0.9, 0.9];
const SPINE_FILL: Rgb = [0.93, 0.93, 0.96];

/** The barcode box the KDP template shows; the help page doesn't publish its size, so it is only a guide. */
export const BARCODE_GUIDE = { w: 2, h: 1.2, margin: 0.25 } as const;

export interface TemplateLabels {
  title: string;
  back: string;
  spine: string;
  front: string;
  bleed: string;
  trim: string;
  safe: string;
  barcode: string;
  noSpineText: string;
  size: string;
}

/** What a printer's template shows: bleed, trim, text-safe lines, the spine and its clearance, the barcode guide. */
export function coverTemplate(c: CoverSize, hasSpineText: boolean, L: TemplateLabels): Op[] {
  const b = c.bleed;
  const ops: Op[] = [];
  const { width: W, height: H } = c;
  const backX = b;
  const spineX = b + c.trimWidth;
  const frontX = spineX + c.spine;
  const safe = 0.125; // KDP: text at least 0.125 in inside the trim lines
  // The bleed band is tinted, so it is plain what gets cut off.
  ops.push({ k: "rect", x: 0, y: 0, w: W, h: H, fill: PINK });
  ops.push({ k: "rect", x: b, y: b, w: W - 2 * b, h: H - 2 * b, fill: [1, 1, 1] });
  ops.push({ k: "rect", x: spineX, y: b, w: c.spine, h: c.trimHeight, fill: SPINE_FILL });
  // Trim line and fold lines.
  ops.push({ k: "rect", x: b, y: b, w: W - 2 * b, h: H - 2 * b, stroke: RED });
  for (const x of [spineX, frontX]) ops.push({ k: "line", x1: x, y1: 0, x2: x, y2: H, stroke: BLUE });
  // Text-safe lines on the back and front covers.
  for (const x of [backX, frontX]) ops.push({ k: "rect", x: x + safe, y: b + safe, w: c.trimWidth - 2 * safe, h: c.trimHeight - 2 * safe, stroke: GREEN, dash: true });
  // Spine clearance, only where spine text is allowed.
  if (hasSpineText) {
    const clear = FIGURES.spineTextClearance;
    ops.push({ k: "rect", x: spineX + clear, y: b + safe, w: Math.max(0, c.spine - 2 * clear), h: c.trimHeight - 2 * safe, stroke: GREEN, dash: true });
  }
  // Barcode guide at the lower right of the back cover.
  const bc = BARCODE_GUIDE;
  ops.push({ k: "rect", x: backX + c.trimWidth - bc.margin - bc.w, y: b + c.trimHeight - bc.margin - bc.h, w: bc.w, h: bc.h, stroke: GREY, dash: true });
  ops.push({ k: "text", x: backX + c.trimWidth - bc.margin - bc.w / 2, y: b + c.trimHeight - bc.margin - bc.h / 2, size: 9, text: L.barcode, fill: GREY, anchor: "middle" });
  // Labels.
  ops.push({ k: "text", x: backX + c.trimWidth / 2, y: b + 0.9, size: 14, text: L.back, fill: GREY, anchor: "middle" });
  ops.push({ k: "text", x: frontX + c.trimWidth / 2, y: b + 0.9, size: 14, text: L.front, fill: GREY, anchor: "middle" });
  ops.push({ k: "text", x: frontX + c.trimWidth / 2, y: b + 1.25, size: 8, text: L.size, fill: GREY, anchor: "middle" });
  if (c.spine >= 0.16) ops.push({ k: "text", x: spineX + c.spine / 2, y: b + c.trimHeight / 2, size: 8, text: hasSpineText ? L.spine : L.noSpineText, fill: GREY, anchor: "middle", rotate: true });
  ops.push({ k: "text", x: b + 0.1, y: H - b - 0.1, size: 6.5, text: `${L.bleed} · ${L.trim} · ${L.safe}`, fill: GREY });
  ops.push({ k: "text", x: b + 0.1, y: b - 0.04, size: 6.5, text: L.title, fill: GREY });
  return ops;
}
