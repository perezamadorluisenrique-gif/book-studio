// Paint a laid-out page onto a canvas. Glyphs are drawn from the same font
// outlines and shaping the PDF writer uses, so the preview matches the print
// file exactly, including kerning, ligatures and small capitals.

import { parseFaceKey, type FontSet } from "../engine/fonts";
import type { ImageAsset } from "../engine/model";
import type { Layout, LayoutPage } from "../engine/layout/types";

export interface PaintOptions {
  /** CSS pixels per point. */
  scale: number;
  /** Device pixel ratio the canvas backing store uses. */
  dpr: number;
  /** Shade the margins and show the bleed edge. */
  guides?: boolean;
  ink?: string;
  paper?: string;
}

type Bitmap = ImageBitmap | HTMLImageElement;

/** Caches glyph outlines and decoded images across pages. */
export class PagePainter {
  private paths = new Map<string, Path2D>();
  private bitmaps = new Map<string, Promise<Bitmap | null>>();

  constructor(
    private fonts: FontSet,
    private images: Map<string, ImageAsset>,
  ) {}

  private glyph(file: Parameters<FontSet["glyphPath"]>[0], id: number): Path2D {
    const k = `${file}:${id}`;
    let p = this.paths.get(k);
    if (!p) {
      p = new Path2D(this.fonts.glyphPath(file, id));
      this.paths.set(k, p);
    }
    return p;
  }

  private bitmap(path: string): Promise<Bitmap | null> {
    let b = this.bitmaps.get(path);
    if (!b) {
      const asset = this.images.get(path);
      b = asset ? decode(asset) : Promise.resolve(null);
      this.bitmaps.set(path, b);
    }
    return b;
  }

  /** Paint `page` into `canvas`, sizing the canvas to the trimmed page (plus bleed when guides are on). */
  async paint(canvas: HTMLCanvasElement, layout: Layout, page: LayoutPage, opts: PaintOptions): Promise<void> {
    const bleed = opts.guides ? layout.bleedPt : 0;
    const wPt = layout.widthPt + bleed;
    const hPt = layout.heightPt + 2 * bleed;
    const k = opts.scale * opts.dpr;
    const W = Math.round(wPt * k);
    const H = Math.round(hPt * k);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    // Decode images first so the page paints in one go.
    const bitmaps = new Map<string, Bitmap | null>();
    for (const d of page.draws) if (d.kind === "image" && !bitmaps.has(d.path)) bitmaps.set(d.path, await this.bitmap(d.path));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opts.paper ?? "#fffdf8";
    ctx.fillRect(0, 0, W, H);
    // Bleed sits on the outside edge: left of a verso, right of a recto.
    const ox = bleed && !page.recto ? bleed : 0;
    ctx.setTransform(k, 0, 0, k, ox * k, bleed * k);

    if (opts.guides) this.guides(ctx, layout, page, bleed);

    const ink = opts.ink ?? "#1b1b1b";
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    for (const d of page.draws) {
      if (d.kind === "text") {
        const { file } = parseFaceKey(d.face);
        const upm = this.fonts.unitsPerEm(file);
        const s = d.size / upm;
        const shaped = this.fonts.shape(d.face, d.text);
        let x = 0;
        ctx.save();
        ctx.translate(d.x, d.y);
        if (d.angle) ctx.rotate((-d.angle * Math.PI) / 180);
        if (d.color) ctx.fillStyle = `rgb(${d.color.map((c) => Math.round(c * 255)).join(",")})`;
        for (const g of shaped.glyphs) {
          ctx.save();
          ctx.translate(x + g.xOffset * s, -g.yOffset * s);
          ctx.scale(s, -s);
          ctx.fill(this.glyph(file, g.id));
          ctx.restore();
          x += g.xAdvance * s + (d.tracking ?? 0);
        }
        ctx.restore();
      } else if (d.kind === "image") {
        const bmp = bitmaps.get(d.path);
        if (bmp) {
          ctx.save();
          if (d.clip) {
            ctx.beginPath();
            ctx.rect(d.clip.x, d.clip.y, d.clip.w, d.clip.h);
            ctx.clip();
          }
          ctx.drawImage(bmp, d.x, d.y, d.w, d.h);
          ctx.restore();
        } else {
          ctx.save();
          ctx.strokeStyle = "#c33";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(d.x, d.y, d.w, d.h);
          ctx.restore();
        }
      } else if (d.kind === "rect") {
        ctx.save();
        if (d.fill) {
          ctx.fillStyle = `rgb(${d.fill.map((c) => Math.round(c * 255)).join(",")})`;
          ctx.fillRect(d.x, d.y, d.w, d.h);
        }
        if (d.stroke || !d.fill) {
          ctx.strokeStyle = d.stroke ? `rgb(${d.stroke.map((c) => Math.round(c * 255)).join(",")})` : ink;
          ctx.lineWidth = d.strokeWidth ?? 0.5;
          ctx.setLineDash(d.dash ?? []);
          ctx.strokeRect(d.x, d.y, d.w, d.h);
        }
        ctx.restore();
      } else {
        ctx.lineWidth = d.width;
        ctx.beginPath();
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x2, d.y2);
        ctx.stroke();
      }
    }
  }

  private guides(ctx: CanvasRenderingContext2D, layout: Layout, page: LayoutPage, bleed: number): void {
    const { margins: m, widthPt: w, heightPt: h } = layout;
    const left = page.recto ? m.inside : m.outside;
    const right = page.recto ? m.outside : m.inside;
    ctx.save();
    ctx.fillStyle = "rgba(70, 120, 200, 0.06)";
    ctx.fillRect(0, 0, w, m.top);
    ctx.fillRect(0, h - m.bottom, w, m.bottom);
    ctx.fillRect(0, m.top, left, h - m.top - m.bottom);
    ctx.fillRect(w - right, m.top, right, h - m.top - m.bottom);
    if (bleed) {
      ctx.strokeStyle = "rgba(200, 60, 60, 0.6)";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(0, 0, w, h);
    }
    ctx.restore();
  }

  dispose(): void {
    for (const b of this.bitmaps.values()) void b.then((bmp) => (bmp && "close" in bmp ? bmp.close() : undefined));
    this.bitmaps.clear();
    this.paths.clear();
  }
}

async function decode(asset: ImageAsset): Promise<Bitmap | null> {
  const blob = new Blob([asset.bytes as BlobPart], { type: asset.mime });
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}
