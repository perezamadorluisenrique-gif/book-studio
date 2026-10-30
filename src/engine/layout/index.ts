// The print layout: front matter, chapters and back matter on mirrored pages,
// with running heads, folios and KDP's page-count–dependent gutter.

import type { FontSet } from "../fonts";
import { hyphenatorFor } from "../hyphenate";
import { chapterLabel, partHeading, roman, strings } from "../i18n";
import { buildIndex, parseIndexSpecs } from "../index-terms";
import { INDEX_ID, NOTES_ID, notesHeadingId, type Book, type Chapter, type Matter, type Note } from "../model";
import { themeById } from "../themes";
import { DEFAULT_TRIM, KDP_MAX_PAGES, KDP_MIN_PAGES, BLEED, kdpMinInside, kdpMinOutside, trimById } from "../trims";
import { FlowBuilder, type FlowEnv } from "./blocks";
import { alsoByPage, copyrightPage, dedicationPage, epigraphPage, halfTitlePage, partPage, titlePage, tocPages, type DisplayPage, type TocLine } from "./front";
import { ParagraphSetter } from "./inline";
import { offsetDraw, paginate, type FlowPage, type FootnoteSource } from "./paginate";
import { fromTextStyle, Styler } from "./style";
import type { Draw, Layout, LayoutPage, LayoutWarning, PageRole, TextPos, TocEntry } from "./types";

export type { Layout, LayoutPage, LayoutWarning, Draw, TextDraw, ImageDraw, RectDraw, RuleDraw, Rgb, TocEntry, TextPos } from "./types";

interface RawPage {
  role: PageRole;
  matter: Matter;
  chapterId?: string;
  draws: Draw[];
  start?: TextPos;
  showFolio: boolean;
}

const PT = 72;

export function layoutBook(book: Book, fonts: FontSet): Layout {
  const settings = book.settings;
  const theme = themeById(settings.theme);
  const trim = trimById(settings.trim) ?? trimById(DEFAULT_TRIM)!;
  const minOut = kdpMinOutside(settings.bleed);
  let inside = Math.max(theme.margins.inside, kdpMinInside(1));
  let result = compose(book, fonts, inside);
  for (let pass = 0; pass < 3; pass++) {
    const need = kdpMinInside(result.pages.length);
    if (need <= inside + 1e-9) break;
    inside = need;
    result = compose(book, fonts, inside);
  }
  const outside = Math.max(theme.margins.outside, minOut);
  const top = Math.max(theme.margins.top, minOut);
  const bottom = Math.max(theme.margins.bottom, minOut);
  const warnings = result.warnings;
  const pages = result.pages;
  const count = pages.length;
  if (count > KDP_MAX_PAGES) {
    warnings.push({ severity: "error", message: `The book has ${count} pages; KDP paperbacks allow at most ${KDP_MAX_PAGES}. Use a larger trim size or a smaller type size.` });
  }
  warnings.push({
    severity: "info",
    message: `${count} pages at ${trim.label}. Inside margin ${inside.toFixed(3).replace(/0+$/, "")} in (KDP minimum for this page count: ${kdpMinInside(count)} in).`,
  });
  return {
    trim,
    widthPt: trim.width * PT,
    heightPt: trim.height * PT,
    bleedPt: settings.bleed ? BLEED * PT : 0,
    margins: { top: top * PT, bottom: bottom * PT, inside: inside * PT, outside: outside * PT },
    pages,
    toc: result.toc,
    warnings: dedupe(warnings),
    bodyStart: result.bodyStart,
  };
}

function compose(book: Book, fonts: FontSet, insideIn: number): { pages: LayoutPage[]; toc: TocEntry[]; warnings: LayoutWarning[]; bodyStart: number } {
  const { settings, meta } = book;
  const theme = themeById(settings.theme);
  const trim = trimById(settings.trim) ?? trimById(DEFAULT_TRIM)!;
  const lang = meta.language;
  const minOut = kdpMinOutside(settings.bleed);
  const outside = Math.max(theme.margins.outside, minOut) * PT;
  const inside = insideIn * PT;
  const top = Math.max(theme.margins.top, minOut) * PT;
  const bottom = Math.max(theme.margins.bottom, minOut) * PT;
  const pageW = trim.width * PT;
  const pageH = trim.height * PT;
  const bodySize = settings.fontSize ?? theme.body.size;
  const leading = (theme.body.leading * bodySize) / theme.body.size;
  const width = pageW - inside - outside;
  const capacity = Math.floor((pageH - top - bottom) / leading + 0.001) * leading;
  const warnings: LayoutWarning[] = [];
  const styler = new Styler(fonts, lang);
  const hyphenate = settings.hyphenate && theme.body.hyphenate;
  const setter = new ParagraphSetter(styler, hyphenate ? hyphenatorFor(lang) : null);
  const noteNumbers = new Map<string, number>();
  for (const ch of book.chapters) for (const n of ch.notes) noteNumbers.set(n.id, n.number);
  const env: FlowEnv = {
    styler,
    setter,
    theme,
    lang,
    bodySize,
    leading,
    width,
    capacity,
    hyphenate,
    sceneGlyph: settings.sceneBreak ?? theme.sceneBreak.glyph,
    images: book.images,
    noteNumber: (id) => noteNumbers.get(id),
    warn: (w) => warnings.push(w),
  };
  const fb = new FlowBuilder(env);
  const atFoot = settings.footnotes === "page";
  const noteById = new Map<string, Note>();
  for (const ch of book.chapters) for (const n of ch.notes) noteById.set(n.id, n);
  const footCache = new Map<string, { height: number; draws: Draw[] }>();
  const footOf = (id: string) => {
    let hit = footCache.get(id);
    if (!hit) {
      const note = noteById.get(id);
      // A note can't take more than half the text block, or the line that calls it would have no room.
      const set = note ? fb.footnote(note, Math.max(2, Math.floor(capacity / 2 / leading))) : { height: 0, draws: [], cut: false };
      if (note && set.cut) warnings.push({ severity: "warning", message: `Footnote ${note.number} is longer than half a page, so it was cut short at the foot of the page. Shorten it, or set notes at the end of the book.`, src: note.src });
      hit = { height: set.height, draws: set.draws };
      footCache.set(id, hit);
    }
    return hit;
  };
  const foot: FootnoteSource | undefined = atFoot ? { separator: leading, ruleWidth: width * 0.3, height: (id) => footOf(id).height, draws: (id) => footOf(id).draws } : undefined;
  const startRecto = settings.chapterStart === "recto";

  const display = (p: DisplayPage, matter: Matter): RawPage => ({ role: p.role, matter, draws: p.draws, start: p.start, showFolio: false });
  const blank = (matter: Matter): RawPage => ({ role: "blank", matter, draws: [], showFolio: false });
  const ensureRecto = (list: RawPage[], matter: Matter) => {
    if (list.length % 2 === 1) list.push(blank(matter));
  };

  const chapterPages = (ch: Chapter, matter: Matter, flow: FlowPage[]): RawPage[] =>
    flow.map((p, i) => {
      if (p.overflow) warnings.push({ severity: "warning", message: `Something in “${ch.titleText}” is taller than a page and was cut off.`, src: ch.src });
      return { role: i === 0 ? "opener" : "body", matter, chapterId: ch.id, draws: p.draws, start: p.start, showFolio: i === 0 ? theme.folio.onOpeners : true };
    });

  const layChapter = (ch: Chapter): FlowPage[] => paginate([...fb.opener(ch), ...fb.chapterBody(ch, { dropCap: ch.matter === "body" || ch.type === "prologue" })], capacity, foot);

  // ── Body and back matter (numbered from 1 on a recto) ─────────
  const body: RawPage[] = [];
  const firstPage = new Map<string, number>();
  const bodyChapters = book.chapters.filter((c) => c.matter === "body");
  const backChapters = book.chapters.filter((c) => c.matter === "back");
  const placeChapter = (ch: Chapter, list: RawPage[], matter: Matter) => {
    if (startRecto) ensureRecto(list, matter);
    firstPage.set(ch.id, list.length);
    list.push(...chapterPages(ch, matter, layChapter(ch)));
  };
  for (const ch of bodyChapters) {
    if (ch.type === "part") {
      ensureRecto(body, "body");
      firstPage.set(ch.id, body.length);
      body.push({ ...display(partPage(fb, theme, ch, lang), "body"), chapterId: ch.id });
      body.push(blank("body"));
      continue;
    }
    placeChapter(ch, body, "body");
  }
  for (const ch of backChapters) placeChapter(ch, body, "back");

  const withNotes = atFoot ? [] : book.chapters.filter((c) => c.notes.length);
  let notesChapter: Chapter | undefined;
  if (withNotes.length) {
    const title = strings(lang).notes;
    notesChapter = { id: NOTES_ID, matter: "back", type: "other", title: [{ kind: "text", text: title, style: {} }], titleText: title, blocks: [], notes: [] };
    const items = [...fb.opener(notesChapter)];
    for (const ch of withNotes) {
      const heading = ch.number !== undefined ? `${chapterLabel(ch.number, lang, "numeral", true)}. ${ch.titleText}` : ch.titleText;
      items.push(...fb.notesFor(ch, notesHeadingId(ch.id), heading));
    }
    if (startRecto) ensureRecto(body, "back");
    firstPage.set(NOTES_ID, body.length);
    body.push(...chapterPages(notesChapter, "back", paginate(items, capacity)));
  }

  // ── Back-of-book index, found on the pages above ──────────────
  let indexChapter: Chapter | undefined;
  const specs = parseIndexSpecs(meta.indexTerms);
  if (specs.length) {
    const found = buildIndex(
      specs,
      body.map((p, i) => ({ folio: String(i + 1), text: pageText(p.draws, fonts) })),
      lang,
    );
    for (const term of found.missing) warnings.push({ severity: "warning", message: `The index term “${term}” doesn't appear in the book, so it isn't in the index.`, src: { file: book.manifestPath, line: 1 } });
    if (found.entries.length) {
      const title = strings(lang).index;
      indexChapter = { id: INDEX_ID, matter: "back", type: "other", title: [{ kind: "text", text: title, style: {} }], titleText: title, blocks: [], notes: [] };
      const opener = fb.opener(indexChapter);
      const openerH = opener.reduce((a, it) => a + (it.type === "box" || it.type === "space" ? it.height : 0), 0);
      const gap = bodySize * 1.6;
      const colW = (width - gap) / 2;
      // Two columns: the flow runs through left, right, left, right…, shorter on the first page under the heading.
      const flow = paginate(fb.indexItems(found.entries, colW, strings(lang).see), (k) => (k < 2 ? capacity - openerH : capacity));
      const first = paginate(opener, capacity)[0];
      const raw2: RawPage[] = [];
      for (let k = 0; k < flow.length; k += 2) {
        const page = Math.floor(k / 2);
        const left = flow[k];
        const right = flow[k + 1];
        const dy = page === 0 ? openerH : 0;
        const draws: Draw[] = page === 0 ? [...first.draws] : [];
        for (const d of left.draws) draws.push(offsetDraw(d, 0, dy));
        if (right) for (const d of right.draws) draws.push(offsetDraw(d, colW + gap, dy));
        raw2.push({ role: page === 0 ? "opener" : "body", matter: "back", chapterId: INDEX_ID, draws, start: left.start, showFolio: page === 0 ? theme.folio.onOpeners : true });
      }
      if (startRecto) ensureRecto(body, "back");
      firstPage.set(INDEX_ID, body.length);
      body.push(...raw2);
    }
  }

  // ── Front matter (roman folios) ───────────────────────────────
  const frontChapters = book.chapters.filter((c) => c.matter === "front");
  const tocChapters: Chapter[] = [...frontChapters, ...bodyChapters, ...backChapters, ...(notesChapter ? [notesChapter] : []), ...(indexChapter ? [indexChapter] : [])];
  const buildFront = (tocLines: TocLine[] | null) => {
    const front: RawPage[] = [];
    const frontFirst = new Map<string, number>();
    if (settings.halfTitle) {
      front.push(display(halfTitlePage(fb, theme, meta), "front"));
      front.push(meta.alsoBy?.length ? display(alsoByPage(fb, theme, meta, lang), "front") : blank("front"));
    }
    ensureRecto(front, "front");
    front.push(display(titlePage(fb, theme, meta), "front"));
    front.push(display(copyrightPage(fb, meta, lang), "front"));
    if (meta.dedication) {
      ensureRecto(front, "front");
      front.push(display(dedicationPage(fb, meta), "front"));
    }
    if (meta.epigraph) {
      ensureRecto(front, "front");
      front.push(display(epigraphPage(fb, meta), "front"));
    }
    let tocStart = -1;
    let tocCount = 0;
    if (settings.toc && tocLines) {
      ensureRecto(front, "front");
      tocStart = front.length;
      const pages = tocPages(fb, theme, tocLines, lang);
      tocCount = pages.length;
      pages.forEach((p, i) => front.push({ role: "toc", matter: "front", draws: p.draws, start: p.start, showFolio: i > 0 }));
    }
    for (const ch of frontChapters) {
      if (startRecto) ensureRecto(front, "front");
      frontFirst.set(ch.id, front.length);
      front.push(...chapterPages(ch, "front", layChapter(ch)));
    }
    if (front.length % 2 === 1) front.push(blank("front"));
    return { front, frontFirst, tocStart, tocCount };
  };

  const folioOf = (ch: Chapter, frontFirst: Map<string, number>): string => {
    if (ch.matter === "front") return roman((frontFirst.get(ch.id) ?? 0) + 1, true);
    return String((firstPage.get(ch.id) ?? 0) + 1);
  };
  // First pass with placeholder folios to learn how long the contents run.
  let built = buildFront(settings.toc ? tocChapters.map((c) => ({ chapter: c, folio: "000" })) : null);
  for (let i = 0; i < 3 && settings.toc; i++) {
    const lines = tocChapters.map((c) => ({ chapter: c, folio: folioOf(c, built.frontFirst) }));
    const next = buildFront(lines);
    const stable = next.front.length === built.front.length && next.tocCount === built.tocCount;
    built = next;
    if (stable) break;
  }
  const { front, frontFirst } = built;

  // ── Assemble and decorate ─────────────────────────────────────
  const raw = [...front, ...body];
  while (raw.length < KDP_MIN_PAGES) raw.push(blank("back"));
  if (raw.length % 2 === 1) raw.push(blank("back"));
  if (front.length + body.length < KDP_MIN_PAGES) {
    warnings.push({ severity: "info", message: `KDP needs at least ${KDP_MIN_PAGES} pages; blank pages were added at the end.` });
  }

  const chapterById = new Map(book.chapters.map((c) => [c.id, c]));
  if (notesChapter) chapterById.set(NOTES_ID, notesChapter);
  if (indexChapter) chapterById.set(INDEX_ID, indexChapter);
  const rh = fromTextStyle(theme.runningHead, theme.body.oldstyle);
  const folioStyle = fromTextStyle(theme.folio.style, theme.body.oldstyle);
  const headerY = Math.max(top - leading * 1.15, minOut * PT + rh.size * 0.75);
  const footerY = Math.min(pageH - bottom + leading * 1.6, pageH - minOut * PT - folioStyle.size * 0.3);
  const authorLine = meta.authors.join(lang.startsWith("es") ? " y " : " & ");

  const pages: LayoutPage[] = raw.map((p, index) => {
    const recto = index % 2 === 0;
    const left = recto ? inside : outside;
    const draws = p.draws.map((d) => offsetDraw(d, left, top));
    const isFront = index < front.length;
    const folio = isFront ? roman(index + 1, true) : String(index - front.length + 1);
    const ch = p.chapterId ? chapterById.get(p.chapterId) : undefined;
    if (p.role === "body" && settings.runningHeads !== "none") {
      let text: string;
      if (settings.runningHeads === "author-title") text = recto ? meta.title : authorLine || meta.title;
      else text = recto ? (ch?.titleText ?? meta.title) : meta.title;
      draws.push(...fb.textLine(text, rh, width, "center", headerY, left));
    }
    if (p.showFolio) {
      const atFoot = theme.folio.position === "bottom-center" || p.role === "opener" || p.role === "toc";
      if (atFoot) draws.push(...fb.textLine(folio, folioStyle, width, "center", footerY, left));
      else draws.push(...fb.textLine(folio, folioStyle, width, recto ? "right" : "left", headerY, left));
    }
    return { index, folio, showFolio: p.showFolio, recto, role: p.role, matter: p.matter, chapterId: p.chapterId, draws, start: p.start };
  });

  const toc: TocEntry[] = tocChapters.map((c) => ({
    chapterId: c.id,
    title: c.type === "part" ? partHeading(c, lang).full : c.number !== undefined ? `${c.number}. ${c.titleText}` : c.titleText,
    folio: folioOf(c, frontFirst),
    level: c.type === "part" ? 0 : 1,
    matter: c.matter,
  }));

  checkGlyphs(pages, fonts, warnings);
  return { pages, toc, warnings, bodyStart: front.length };
}

/** The text of a page's draws as lines, closest to how it reads, for finding index terms. */
function pageText(draws: Draw[], fonts: FontSet): string {
  const texts = draws.filter((d): d is Extract<Draw, { kind: "text" }> => d.kind === "text").sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: string[] = [];
  let line = "";
  let y = NaN;
  let end = 0;
  for (const d of texts) {
    if (Math.abs(d.y - y) > d.size * 0.35 || Number.isNaN(y)) {
      if (line) lines.push(line);
      line = d.text;
      y = d.y;
    } else {
      // Words are separate runs with a gap between them; a style change inside a word has none.
      line += d.x - end > 0.5 ? ` ${d.text}` : d.text;
    }
    end = d.x + fonts.width(d.face, d.text, d.size, d.tracking ?? 0);
  }
  if (line) lines.push(line);
  return lines.join(" ");
}

function checkGlyphs(pages: LayoutPage[], fonts: FontSet, warnings: LayoutWarning[]): void {
  const missing = new Set<string>();
  const seen = new Set<string>();
  for (const p of pages) {
    for (const d of p.draws) {
      if (d.kind !== "text") continue;
      const file = d.face.split("|")[0] as Parameters<FontSet["missing"]>[0];
      const key = file + "\u0000" + d.text;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const ch of fonts.missing(file, d.text)) missing.add(ch);
    }
  }
  if (missing.size) {
    const list = [...missing].map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`).join(", ");
    warnings.push({ severity: "warning", message: `No bundled font can print these characters: ${list}.` });
  }
}

function dedupe(warnings: LayoutWarning[]): LayoutWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const k = `${w.severity}|${w.message}|${w.src?.file ?? ""}:${w.src?.line ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
