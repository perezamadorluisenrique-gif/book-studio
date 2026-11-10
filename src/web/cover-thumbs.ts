// Small pictures of cover templates filled with the open book's title and author, for the first-book guide's
// cover step. They use the finished book's page count, so the spine is the right thickness.

import type { Built } from "../app/pipeline";
import { composeCover } from "../engine/cover/cover";
import type { CoverDesign } from "../engine/cover/design";
import { coverInfo, templateById } from "../engine/cover/templates";
import type { FontSet } from "../engine/fonts";
import { PagePainter } from "../preview/canvas";

export interface CoverBase {
  built: Built;
  fonts: FontSet;
}

/** The template `id` filled with this book's texts, sized to its page count; null for an unknown template. */
export function designFor(base: CoverBase, id: string): CoverDesign | null {
  const tpl = templateById(id);
  if (!tpl) return null;
  const g = composeCover(base.built.book, base.fonts, base.built.layout.pages.length).geometry;
  return tpl.build(coverInfo(base.built.book), g);
}

/** The front cover of template `id` on a canvas about `width` px wide. */
export async function coverThumbnail(base: CoverBase, id: string, width: number): Promise<HTMLCanvasElement | null> {
  try {
    const design = designFor(base, id);
    if (!design) return null;
    const { book } = base.built;
    const withDesign = { ...book, meta: { ...book.meta, coverLayout: design } };
    const cover = composeCover(withDesign, base.fonts, base.built.layout.pages.length);
    const g = cover.geometry;
    // Paint the whole sheet, then keep the front panel (without bleed).
    const sheet = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = width / (g.front.w * 72);
    const painter = new PagePainter(base.fonts, book.images);
    await painter.paint(sheet, cover.layout, cover.layout.pages[0], { scale, dpr, paper: "#ffffff" });
    painter.dispose();
    const out = document.createElement("canvas");
    out.width = Math.round(g.front.w * 72 * scale * dpr);
    out.height = Math.round(g.front.h * 72 * scale * dpr);
    out.getContext("2d")?.drawImage(sheet, g.front.x * 72 * scale * dpr, g.front.y * 72 * scale * dpr, out.width, out.height, 0, 0, out.width, out.height);
    out.style.width = `${width}px`;
    return out;
  } catch {
    return null;
  }
}
