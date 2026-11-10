// A small picture of the first page of chapter one in a style, for the first-book guide's style step.
// It sets only the start of that chapter, so five styles cost a fraction of one full layout.

import { loadBook } from "../engine/book";
import type { FontSet } from "../engine/fonts";
import { loadHyphenator } from "../engine/hyphenate";
import { layoutBook } from "../engine/layout/index";
import { bookOrder } from "../project/ops";
import { chapterById, type Project } from "../project/model";
import { projectToVault } from "../project/to-vault";
import { PagePainter } from "../preview/canvas";

/** How much of the chapter is set: enough to fill a page in any style. */
const EXCERPT = 3500;

/** The start of the first chapter that has text, cut at a paragraph, without its pictures. */
export function excerptProject(p: Project): Project {
  const first = bookOrder(p).map((id) => chapterById(p, id)).find((c) => c && c.body.trim().length > 0) ?? p.chapters[0];
  const paragraphs = (first?.body ?? "").split(/\n{2,}/).filter((para) => !/^\s*!\[/.test(para));
  let text = "";
  for (const para of paragraphs) {
    if (text && text.length + para.length > EXCERPT) break;
    text += (text ? "\n\n" : "") + para;
  }
  const chapter = { id: "c1", title: first?.title ?? "", body: text };
  const { cover: _cover, ...meta } = p.meta;
  return { ...p, meta, assets: [], sections: [{ kind: "body", chapterIds: ["c1"] }], chapters: [chapter] };
}

/** Draw the chapter opener of `p` in `theme` on a canvas about `width` px wide; null when it can't be set. */
export async function themeThumbnail(p: Project, theme: string, trim: string, fonts: FontSet, width: number): Promise<HTMLCanvasElement | null> {
  try {
    const mini = excerptProject({ ...p, settings: { ...p.settings, theme, trim } });
    const vault = projectToVault(mini);
    const book = await loadBook(vault, vault.bookPath, { theme, trim });
    const layout = layoutBook(book, fonts, { hyphenator: book.settings.hyphenate ? await loadHyphenator(book.meta.language) : null });
    const page = layout.pages.find((pg) => pg.role === "opener") ?? layout.pages.find((pg) => pg.role === "body");
    if (!page) return null;
    const canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    await new PagePainter(fonts, book.images).paint(canvas, layout, page, { scale: width / layout.widthPt, dpr });
    canvas.style.width = `${width}px`;
    return canvas;
  } catch {
    return null;
  }
}
