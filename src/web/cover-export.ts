// Pictures made from the finished cover: the front cover as a JPG for ebook stores and the EPUB, and a wide
// PNG for sharing. Both are drawn with the same painter as the preview, so they match what the designer shows.

import type { Cover } from "../engine/cover/cover";
import type { PagePainter } from "../preview/canvas";

export const EBOOK_SIZE = { w: 1600, h: 2560 } as const;
export const SOCIAL_SIZE = { w: 1200, h: 630 } as const;

/** The part of a `sw × sh` picture that fills a `dw × dh` box when scaled to cover it, centred. */
export function coverFit(sw: number, sh: number, dw: number, dh: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale;
  const h = dh / scale;
  return { sx: (sw - w) / 2, sy: (sh - h) / 2, sw: w, sh: h };
}

async function sheet(cover: Cover, painter: PagePainter, pxPerPt: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  await painter.paint(canvas, cover.layout, cover.layout.pages[0], { scale: pxPerPt, dpr: 1, paper: "#ffffff" });
  return canvas;
}

const blob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? void b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("The picture could not be made."))), type, quality));

/** The front cover (trim only, no bleed) as a 1600 × 2560 JPG; a front that is not that shape loses a little at the sides or the foot. */
export async function ebookCoverJpeg(cover: Cover, painter: PagePainter): Promise<Uint8Array> {
  const g = cover.geometry;
  const k = Math.max(EBOOK_SIZE.h / (g.trim.height * 72), EBOOK_SIZE.w / (g.trim.width * 72));
  const full = await sheet(cover, painter, k);
  const out = document.createElement("canvas");
  out.width = EBOOK_SIZE.w;
  out.height = EBOOK_SIZE.h;
  const ctx = out.getContext("2d")!;
  const fx = g.front.x * 72 * k;
  const fy = g.front.y * 72 * k;
  const fw = g.front.w * 72 * k;
  const fh = g.front.h * 72 * k;
  const c = coverFit(fw, fh, EBOOK_SIZE.w, EBOOK_SIZE.h);
  ctx.drawImage(full, fx + c.sx, fy + c.sy, c.sw, c.sh, 0, 0, EBOOK_SIZE.w, EBOOK_SIZE.h);
  return blob(out, "image/jpeg", 0.92);
}

/** A 1200 × 630 PNG for social posts: the front cover standing on the cover's own colour. */
export async function socialPng(cover: Cover, painter: PagePainter, background: string): Promise<Uint8Array> {
  const g = cover.geometry;
  const k = 3;
  const full = await sheet(cover, painter, k);
  const out = document.createElement("canvas");
  out.width = SOCIAL_SIZE.w;
  out.height = SOCIAL_SIZE.h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  const h = SOCIAL_SIZE.h - 80;
  const w = (h * g.trim.width) / g.trim.height;
  const x = (SOCIAL_SIZE.w - w) / 2;
  ctx.save();
  ctx.shadowColor = "rgb(0 0 0 / 45%)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.drawImage(full, g.front.x * 72 * k, g.front.y * 72 * k, g.front.w * 72 * k, g.front.h * 72 * k, x, 40, w, h);
  ctx.restore();
  return blob(out, "image/png");
}
