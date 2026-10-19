// Display pages: half-title, also-by, title page, copyright page, dedication,
// epigraph, part titles and the table of contents.

import { partHeading, roman, strings } from "../i18n";
import type { BookMeta, Chapter } from "../model";
import type { FlowBuilder } from "./blocks";
import { NO_BREAK, paginate, type FlowPage, type VItem } from "./paginate";
import type { RunStyle } from "./style";
import type { Draw, PageRole, TextPos } from "./types";
import type { Theme } from "../themes";

export interface DisplayPage {
  role: PageRole;
  draws: Draw[];
  start?: TextPos;
}

/** Stack centered lines of display text from `top`, returning the draws and the next free y. */
function stack(fb: FlowBuilder, text: string, style: RunStyle, top: number, opts: { width?: number; align?: "center" | "left" | "right"; gapAfter?: number } = {}): { draws: Draw[]; y: number } {
  const width = opts.width ?? fb.width;
  const align = opts.align ?? "center";
  const left = (fb.width - width) / 2;
  const draws: Draw[] = [];
  let y = top;
  const lineH = Math.max(style.size * 1.25, fb.L);
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      y += lineH * 0.6;
      continue;
    }
    const set = fb.setText([{ kind: "text", text: para.trim(), style: {} }], style, width, align);
    for (let k = 0; k < set.lines.length; k++) {
      y += lineH;
      draws.push(...fb.drawsFor(set, k, left, y - lineH + style.size * 0.9));
    }
  }
  return { draws, y: y + (opts.gapAfter ?? 0) };
}

export function halfTitlePage(fb: FlowBuilder, theme: Theme, meta: BookMeta): DisplayPage {
  const ts = fb.style(theme.titlePage.title);
  const style = { ...ts, size: ts.size * 0.62 };
  return { role: "half-title", draws: stack(fb, meta.title, style, fb.capacity * 0.24, { width: fb.width * 0.9 }).draws, start: { blockId: "halftitle", offset: 0 } };
}

export function alsoByPage(fb: FlowBuilder, theme: Theme, meta: BookMeta, lang: string): DisplayPage {
  const head = fb.style(theme.titlePage.publisher);
  const author = meta.authors[0] ?? "";
  const a = stack(fb, `${strings(lang).alsoBy} ${author}`.trim(), { ...head, size: Math.max(head.size, fb.L * 0.65) }, fb.capacity * 0.12, { gapAfter: fb.L });
  const body: RunStyle = { ...fb.base, italic: true };
  const b = stack(fb, (meta.alsoBy ?? []).join("\n"), body, a.y, { width: fb.width * 0.85 });
  return { role: "also-by", draws: [...a.draws, ...b.draws], start: { blockId: "alsoby", offset: 0 } };
}

export function titlePage(fb: FlowBuilder, theme: Theme, meta: BookMeta): DisplayPage {
  const tp = theme.titlePage;
  const draws: Draw[] = [];
  let r = stack(fb, meta.title, fb.style(tp.title), fb.capacity * 0.18, { width: fb.width * 0.92, gapAfter: fb.L * 0.8 });
  draws.push(...r.draws);
  if (meta.subtitle) {
    r = stack(fb, meta.subtitle, fb.style(tp.subtitle), r.y, { width: fb.width * 0.85 });
    draws.push(...r.draws);
  }
  if (meta.authors.length) {
    r = stack(fb, meta.authors.join("\n"), fb.style(tp.author), Math.max(r.y + fb.L * 2, fb.capacity * 0.5));
    draws.push(...r.draws);
  }
  if (meta.publisher) {
    const ps = fb.style(tp.publisher);
    draws.push(...fb.textLine(meta.publisher, ps, fb.width, "center", fb.capacity - fb.L + fb.baseline));
  }
  return { role: "title", draws, start: { blockId: "titlepage", offset: 0 } };
}

export function copyrightPage(fb: FlowBuilder, meta: BookMeta, lang: string): DisplayPage {
  const style: RunStyle = { ...fb.base, size: fb.base.size * 0.8 };
  const lines: string[] = [];
  lines.push(meta.subtitle ? `${meta.title}: ${meta.subtitle}` : meta.title);
  if (meta.authors.length) lines.push(meta.authors.join(", "));
  lines.push("");
  if (meta.copyright) lines.push(...meta.copyright.split("\n"));
  if (meta.edition) lines.push("", meta.edition);
  if (meta.isbnPrint) lines.push("", `ISBN ${meta.isbnPrint}`);
  if (meta.publisher) lines.push("", lang.startsWith("es") ? `Publicado por ${meta.publisher}` : meta.publisher);
  const lineH = fb.L * 0.85;
  const sets = lines.map((l) => (l ? fb.setText([{ kind: "text", text: l, style: {} }], style, fb.width, "left") : null));
  const total = sets.reduce((h, s) => h + (s ? s.lines.length * lineH : lineH * 0.6), 0);
  let y = fb.capacity - total;
  const draws: Draw[] = [];
  for (const s of sets) {
    if (!s) {
      y += lineH * 0.6;
      continue;
    }
    for (let k = 0; k < s.lines.length; k++) {
      draws.push(...fb.drawsFor(s, k, 0, y + fb.baseline * 0.8));
      y += lineH;
    }
  }
  return { role: "copyright", draws, start: { blockId: "copyright", offset: 0 } };
}

export function dedicationPage(fb: FlowBuilder, meta: BookMeta): DisplayPage {
  const style: RunStyle = { ...fb.base, italic: true };
  return { role: "dedication", draws: stack(fb, meta.dedication ?? "", style, fb.capacity * 0.22, { width: fb.width * 0.8 }).draws, start: { blockId: "dedication", offset: 0 } };
}

export function epigraphPage(fb: FlowBuilder, meta: BookMeta): DisplayPage {
  const style: RunStyle = { ...fb.base, italic: true };
  const r = stack(fb, meta.epigraph ?? "", style, fb.capacity * 0.22, { width: fb.width * 0.75, gapAfter: fb.L * 0.5 });
  const draws = [...r.draws];
  if (meta.epigraphSource) draws.push(...stack(fb, `— ${meta.epigraphSource}`, { ...fb.base }, r.y, { width: fb.width * 0.75, align: "right" }).draws);
  return { role: "epigraph", draws, start: { blockId: "epigraph", offset: 0 } };
}

export function partPage(fb: FlowBuilder, theme: Theme, part: Chapter, lang: string): DisplayPage {
  const draws: Draw[] = [];
  const { label } = partHeading(part, lang);
  let y = fb.capacity * 0.28;
  if (label) {
    const r = stack(fb, label, fb.style(theme.part.label), y, { gapAfter: fb.L });
    draws.push(...r.draws);
    y = r.y;
  }
  draws.push(...stack(fb, part.titleText, fb.style(theme.part.title), y, { width: fb.width * 0.85 }).draws);
  return { role: "part", draws, start: { blockId: part.id, offset: 0 } };
}

export interface TocLine {
  chapter: Chapter;
  folio: string;
}

/** The contents pages; folios may be placeholders on the first pass. */
export function tocPages(fb: FlowBuilder, theme: Theme, lines: TocLine[], lang: string): FlowPage[] {
  const L = fb.L;
  const items: VItem[] = [];
  const strut = (h: number) => ({ type: "box" as const, height: h, draws: [], breakAfter: NO_BREAK });
  items.push({ ...strut(Math.round((fb.capacity * 0.1) / L) * L), start: { blockId: "toc", offset: 0 } });
  const ts = fb.style(theme.chapter.title);
  const th = fb.slotHeight(ts.size);
  const align = theme.chapter.title.align === "left" ? "left" : "center";
  items.push({ type: "box", height: th, draws: fb.textLine(strings(lang).contents, ts, fb.width, align, th - (L - fb.baseline)), breakAfter: NO_BREAK });
  items.push(strut(2 * L));
  const body = fb.base;
  const folioW = fb.textWidth("0000", body);
  const numW = fb.base.size * 2;
  lines.forEach(({ chapter, folio }, i) => {
    if (chapter.type === "part") {
      if (i > 0) items.push({ type: "space", height: L });
      const ps: RunStyle = { ...body, caps: "all", tracking: body.size * 0.08 };
      const text = partHeading(chapter, lang).full;
      items.push({ type: "box", height: L, draws: fb.textLine(text, ps, fb.width, "center", fb.baseline), breakAfter: NO_BREAK });
      items.push({ type: "space", height: L * 0.4 });
      return;
    }
    const numbered = chapter.number !== undefined;
    const left = numbered ? numW : 0;
    const set = fb.setText(chapter.title, body, fb.width - left - folioW - body.size, "left");
    set.lines.forEach((_, k) => {
      const draws = fb.drawsFor(set, k, left, fb.baseline);
      if (k === 0 && numbered) {
        const n = theme.chapter.label.format === "roman" ? roman(chapter.number!) : String(chapter.number);
        draws.push(...fb.textLine(n, body, numW, "left", fb.baseline));
      }
      if (k === set.lines.length - 1) draws.push(...fb.textLine(folio, body, fb.width, "right", fb.baseline));
      items.push({ type: "box", height: L, draws, breakAfter: k === set.lines.length - 1 ? 0 : NO_BREAK });
    });
  });
  return paginate(items, fb.capacity);
}
