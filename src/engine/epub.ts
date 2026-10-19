// EPUB 3 writer: semantic XHTML with EPUB structural semantics and DPUB-ARIA
// roles, a navigation document (contents, landmarks and, with the accessibility
// pack, the print edition's page list), an NCX for older readers, and the
// theme's typography as CSS with the theme's fonts embedded.

import JSZip from "jszip";
import type { AuditResult } from "./a11y";
import { FAMILIES, type Family, type FontFile, type FontSet } from "./fonts";
import { chapterLabel, partHeading, strings } from "./i18n";
import type { Layout } from "./layout/types";
import { NOTES_ID, notesHeadingId, type Block, type Book, type Chapter, type Inline, type InlineStyle, type Matter, type SectionType } from "./model";
import { themeById, type TextStyle, type Theme } from "./themes";

export interface EpubOptions {
  /** Pro: schema.org accessibility metadata, the print page list and the conformance claim. */
  accessiblePack: boolean;
  /** The print layout; with the accessibility pack its pages become the EPUB page list. */
  layout?: Layout;
  /** The audit behind the accessibility metadata (accessibility pack only). */
  audit?: AuditResult;
  /** Claim EPUB Accessibility 1.1 / WCAG 2.1 AA. Only honored when the audit passed. */
  claimConformance?: boolean;
  /** Who certifies the claim; defaults to the publisher, then the authors. */
  certifiedBy?: string;
  /** Embed the theme's fonts. */
  fonts?: FontSet;
  generator?: string;
  modified?: Date;
}

const CONFORMS_TO = "EPUB Accessibility 1.1 - WCAG 2.1 Level AA";

const SECTION: Record<SectionType, { type?: string; role?: string }> = {
  chapter: { type: "chapter", role: "doc-chapter" },
  part: { type: "part", role: "doc-part" },
  prologue: { type: "prologue", role: "doc-prologue" },
  epilogue: { type: "epilogue", role: "doc-epilogue" },
  foreword: { type: "foreword", role: "doc-foreword" },
  preface: { type: "preface", role: "doc-preface" },
  introduction: { type: "introduction", role: "doc-introduction" },
  acknowledgments: { type: "acknowledgments", role: "doc-acknowledgments" },
  afterword: { type: "afterword", role: "doc-afterword" },
  appendix: { type: "appendix", role: "doc-appendix" },
  glossary: { type: "glossary", role: "doc-glossary" },
  bibliography: { type: "bibliography", role: "doc-bibliography" },
  colophon: { type: "colophon", role: "doc-colophon" },
  other: {},
};

/** True for UTF-16 code units XML 1.0 never allows: C0 controls other than tab and newlines, U+FFFE and U+FFFF. */
function forbidden(c: number): boolean {
  return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff;
}

/** Drops characters XML can't carry, including unpaired surrogates. A scan, not a regex: iOS before 16.4 can't parse lookbehind. */
function xmlSafe(s: string): string {
  let out = "";
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const high = c >= 0xd800 && c <= 0xdbff;
    if (high) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    if (high || (c >= 0xdc00 && c <= 0xdfff) || forbidden(c)) {
      out += s.slice(from, i);
      from = i + 1;
    }
  }
  return from === 0 ? s : out + s.slice(from);
}

function esc(s: string): string {
  return xmlSafe(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  return /^(https?:\/\/|mailto:|tel:)/i.test(href.trim()) ? href.trim() : null;
}

// ── Page markers ───────────────────────────────────────────────

interface Slot {
  offset: number;
  labels: string[];
}

const END = "\u0000end";

/** Places the print edition's page breaks in the text, at the block and offset each page starts with. */
class PageMarkers {
  private slots = new Map<string, Slot[]>();
  /** Markers written so far, in reading order. */
  readonly written: { label: string; href: string }[] = [];
  /** The document being written. */
  href = "";

  constructor(layout: Layout | undefined, anchors: Set<string>) {
    if (!layout) return;
    let pending: string[] = [];
    const add = (id: string, offset: number) => {
      const list = this.slots.get(id) ?? [];
      list.push({ offset, labels: pending });
      this.slots.set(id, list);
      pending = [];
    };
    for (const page of layout.pages) {
      pending.push(page.folio);
      if (page.start && anchors.has(page.start.blockId)) add(page.start.blockId, page.start.offset);
    }
    if (pending.length) add(END, 0);
  }


  /** Remove and return the slots for a block, in text order. */
  take(id: string): Slot[] {
    const list = this.slots.get(id);
    if (!list) return [];
    this.slots.delete(id);
    return list.sort((a, b) => a.offset - b.offset);
  }

  html(labels: string[]): string {
    return labels
      .map((label) => {
        this.written.push({ label, href: this.href });
        return `<span id="page-${esc(label)}" epub:type="pagebreak" role="doc-pagebreak" aria-label="${esc(label)}"></span>`;
      })
      .join("");
  }

  /** All markers for a block, for content that cannot hold them inline. */
  before(id: string): string {
    return this.take(id)
      .map((s) => this.html(s.labels))
      .join("");
  }
}

function collectIds(blocks: Block[], out: Set<string>): void {
  for (const b of blocks) {
    out.add(b.id);
    if (b.kind === "blockquote") collectIds(b.blocks, out);
    else if (b.kind === "list") b.items.forEach((it) => collectIds(it, out));
  }
}

// ── XHTML ──────────────────────────────────────────────────────

type RunStyle = InlineStyle & { lead?: boolean };

interface ParaState {
  noIndent: boolean;
  leadIn: number;
  dropCap: boolean;
}

/** Mark the first `words` words of a paragraph for the lead-in. */
function markLeadIn(inlines: Inline[], words: number): Inline[] {
  const out: Inline[] = [];
  let count = 0;
  let inWord = false;
  let done = false;
  for (const i of inlines) {
    if (done || i.kind !== "text") {
      if (i.kind === "break" && inWord) {
        inWord = false;
        if (count >= words) done = true;
      }
      out.push(i);
      continue;
    }
    let cut = i.text.length;
    for (let k = 0; k < i.text.length; k++) {
      const space = /\s/.test(i.text[k]);
      if (!space && !inWord) {
        if (count >= words) {
          cut = k;
          done = true;
          break;
        }
        count++;
        inWord = true;
      } else if (space) inWord = false;
    }
    // Trailing spaces stay outside the lead-in.
    let end = cut;
    while (end > 0 && /\s/.test(i.text[end - 1])) end--;
    if (end > 0) out.push({ kind: "text", text: i.text.slice(0, end), style: { ...i.style, lead: true } as RunStyle });
    if (end < i.text.length) out.push({ kind: "text", text: i.text.slice(end), style: i.style });
  }
  return out;
}

interface WriterCtx {
  book: Book;
  theme: Theme;
  lang: string;
  markers: PageMarkers;
  imageHref: Map<string, string>;
  noteNumber: Map<string, number>;
  /** Times each note has been referenced, for unique reference ids. */
  refCount: Map<string, number>;
  /** Chapter document holding each note's first reference. */
  refDoc: Map<string, string>;
  sceneGlyph: string;
}

function openTags(s: RunStyle): [string, string] {
  let open = "";
  let close = "";
  const wrap = (o: string, c: string) => {
    open += o;
    close = c + close;
  };
  if (s.bold) wrap("<strong>", "</strong>");
  if (s.italic) wrap("<em>", "</em>");
  if (s.code) wrap("<code>", "</code>");
  if (s.smallCaps) wrap('<span class="sc">', "</span>");
  if (s.lead) wrap('<span class="lead">', "</span>");
  if (s.strike) wrap("<s>", "</s>");
  if (s.sup) wrap("<sup>", "</sup>");
  if (s.sub) wrap("<sub>", "</sub>");
  return [open, close];
}

/** Text with page markers spliced in at their offsets; `pos` is the offset of the text's first character. */
function textWithMarkers(text: string, pos: number, slots: Slot[], markers: PageMarkers): string {
  let out = "";
  let from = 0;
  while (slots.length && slots[0].offset < pos + text.length) {
    const cut = Math.max(0, slots[0].offset - pos);
    out += esc(text.slice(from, cut)) + markers.html(slots.shift()!.labels);
    from = cut;
  }
  return out + esc(text.slice(from));
}

function renderInlines(ctx: WriterCtx, inlines: Inline[], slots: Slot[] = []): string {
  let out = "";
  let pos = 0;
  const flush = (upTo: number) => {
    while (slots.length && slots[0].offset <= upTo) out += ctx.markers.html(slots.shift()!.labels);
  };
  let i = 0;
  while (i < inlines.length) {
    const inl = inlines[i];
    if (inl.kind === "break") {
      flush(pos);
      out += "<br/>";
      pos += 1;
      i++;
      continue;
    }
    if (inl.kind === "noteRef") {
      out += noteRef(ctx, inl.noteId);
      i++;
      continue;
    }
    const href = safeHref(inl.style.href);
    let j = i;
    let inner = "";
    do {
      const run = inlines[j] as Extract<Inline, { kind: "text" }>;
      flush(pos);
      const [o, c] = openTags(run.style);
      inner += o + textWithMarkers(run.text, pos, slots, ctx.markers) + c;
      pos += run.text.length;
      j++;
    } while (href && j < inlines.length && inlines[j].kind === "text" && safeHref((inlines[j] as Extract<Inline, { kind: "text" }>).style.href) === href);
    out += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
    i = j;
  }
  flush(Infinity);
  return out;
}

function noteRef(ctx: WriterCtx, noteId: string): string {
  const n = ctx.noteNumber.get(noteId);
  if (n === undefined) return "";
  const count = (ctx.refCount.get(noteId) ?? 0) + 1;
  ctx.refCount.set(noteId, count);
  const id = count === 1 ? `${noteId}-ref` : `${noteId}-ref-${count}`;
  if (count === 1) ctx.refDoc.set(noteId, ctx.markers.href);
  return `<a class="noteref" id="${id}" href="notes.xhtml#${noteId}" epub:type="noteref" role="doc-noteref"><sup>${n}</sup></a>`;
}

function renderBlocks(ctx: WriterCtx, blocks: Block[], state: ParaState, nested: boolean): string {
  const { theme, markers } = ctx;
  let out = "";
  for (const b of blocks) {
    switch (b.kind) {
      case "paragraph": {
        const cls: string[] = [];
        if (state.noIndent && !theme.body.blockParagraphs) cls.push("noindent");
        if (state.dropCap && !nested) cls.push("opening");
        const inlines = !nested && state.leadIn > 0 ? markLeadIn(b.inlines, state.leadIn) : b.inlines;
        out += `<p${cls.length ? ` class="${cls.join(" ")}"` : ""}>${renderInlines(ctx, inlines, markers.take(b.id))}</p>\n`;
        state.noIndent = false;
        state.leadIn = 0;
        state.dropCap = false;
        break;
      }
      case "heading": {
        const level = Math.min(6, Math.max(2, b.level));
        out += `<h${level} id="${b.id}">${renderInlines(ctx, b.inlines, markers.take(b.id))}</h${level}>\n`;
        state.noIndent = true;
        state.dropCap = false;
        break;
      }
      case "sceneBreak":
        out += `${markers.before(b.id)}<hr class="scene"/>\n`;
        state.noIndent = true;
        state.leadIn = theme.firstParagraph.leadInWords;
        break;
      case "pageBreak":
        out += `${markers.before(b.id)}<div class="page-break"></div>\n`;
        state.noIndent = true;
        break;
      case "blockquote":
        out += `${markers.before(b.id)}<blockquote>\n${renderBlocks(ctx, b.blocks, { noIndent: true, leadIn: 0, dropCap: false }, true)}</blockquote>\n`;
        state.noIndent = true;
        break;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
        const items = b.items.map((it) => `<li>${renderBlocks(ctx, it, { noIndent: true, leadIn: 0, dropCap: false }, true).trim()}</li>`).join("\n");
        out += `${markers.before(b.id)}<${tag}${start}>\n${items}\n</${tag}>\n`;
        state.noIndent = true;
        break;
      }
      case "code":
        out += `<pre><code>${textWithMarkers(b.text, 0, markers.take(b.id), markers)}</code></pre>\n`;
        state.noIndent = true;
        break;
      case "image": {
        const img = b.image;
        const src = img.path ? ctx.imageHref.get(img.path) : undefined;
        const before = markers.before(b.id);
        if (!src) {
          // Never reference a missing file; keep the description in the text instead.
          if (img.alt) out += `${before}<p class="noindent missing-image">${esc(img.alt)}</p>\n`;
          else out += before;
        } else {
          const caption = img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : "";
          out += `${before}<figure id="${b.id}" class="image"><img src="../${src}" alt="${esc(img.decorative ? "" : img.alt)}"/>${caption}</figure>\n`;
        }
        state.noIndent = true;
        break;
      }
      case "table": {
        const cls = (k: number) => {
          const a = b.align[k];
          return a === "center" ? ' class="ac"' : a === "right" ? ' class="ar"' : "";
        };
        let t = `${markers.before(b.id)}<table id="${b.id}">`;
        if (b.header.some((c) => c.length)) t += `<thead><tr>${b.header.map((c, k) => `<th scope="col"${cls(k)}>${renderInlines(ctx, c)}</th>`).join("")}</tr></thead>`;
        t += `<tbody>${b.rows.map((r) => `<tr>${r.map((c, k) => `<td${cls(k)}>${renderInlines(ctx, c)}</td>`).join("")}</tr>`).join("")}</tbody></table>\n`;
        out += t;
        state.noIndent = true;
        break;
      }
    }
  }
  return out;
}

function xhtml(title: string, lang: string, body: string, opts: { matter?: Matter; bodyClass?: string; cssHref: string }): string {
  const type = opts.matter ? ` epub:type="${opts.matter === "front" ? "frontmatter" : opts.matter === "body" ? "bodymatter" : "backmatter"}"` : "";
  const cls = opts.bodyClass ? ` class="${opts.bodyClass}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="${opts.cssHref}"/>
</head>
<body${type}${cls}>
${body}</body>
</html>
`;
}

// ── CSS ────────────────────────────────────────────────────────

const SANS = new Set(["montserrat", "atkinson"]);

function familyOf(id: string): Family {
  return FAMILIES[id] ?? FAMILIES["eb-garamond"];
}

function fontStack(id: string): string {
  const generic = id === "inconsolata" ? "monospace" : SANS.has(id) ? "sans-serif" : "serif";
  return `"${familyOf(id).name}", ${generic}`;
}

const em = (v: number) => `${+v.toFixed(3)}em`;
const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function textCss(ts: TextStyle, bodySize: number): string {
  const d = [`font-family: ${fontStack(ts.family)}`, `font-size: ${em(ts.size / bodySize)}`, `font-weight: ${ts.bold ? "bold" : "normal"}`, `font-style: ${ts.italic ? "italic" : "normal"}`];
  if (ts.smallCaps) d.push("font-variant: small-caps", "text-transform: lowercase");
  if (ts.uppercase) d.push("text-transform: uppercase");
  if (ts.tracking) d.push(`letter-spacing: ${em(ts.tracking)}`);
  return d.join("; ");
}

/** Generated decoration that screen readers skip where `content` alt text is supported. */
function decoration(glyph: string): string {
  return `content: ${cssString(glyph)}; content: ${cssString(glyph)} / ""`;
}

/** Font files the EPUB needs for the theme, with their @font-face slots. */
function themeFonts(theme: Theme, book: Book): { family: Family; file: FontFile; bold: boolean; italic: boolean }[] {
  const wanted = new Map<string, Set<string>>();
  const want = (family: string | undefined, bold: boolean, italic: boolean) => {
    if (!family || !FAMILIES[family]) return;
    const set = wanted.get(family) ?? new Set<string>();
    set.add(`${bold ? 1 : 0}${italic ? 1 : 0}`);
    wanted.set(family, set);
  };
  for (const b of [false, true]) for (const i of [false, true]) want(theme.body.family, b, i);
  const styles: TextStyle[] = [theme.chapter.label.style, theme.chapter.title, theme.part.label, theme.part.title, theme.heading2, theme.heading3, theme.titlePage.title, theme.titlePage.subtitle, theme.titlePage.author, theme.titlePage.publisher];
  for (const s of styles) want(s.family, !!s.bold, !!s.italic);
  want(theme.chapter.title.family, !!theme.chapter.title.bold, !theme.chapter.title.italic);
  if (theme.chapter.ornament) want(theme.chapter.ornament.family, false, false);
  want(theme.sceneBreak.family, false, false);
  want(theme.firstParagraph.dropCapFamily, false, false);
  if (usesCode(book)) want("inconsolata", false, false);

  const out: { family: Family; file: FontFile; bold: boolean; italic: boolean }[] = [];
  for (const [id, slots] of wanted) {
    const family = FAMILIES[id];
    const seen = new Set<FontFile>();
    for (const [bold, italic, file] of [
      [false, false, family.regular],
      [false, true, family.italic],
      [true, false, family.bold],
      [true, true, family.boldItalic],
    ] as [boolean, boolean, FontFile][]) {
      if (!slots.has(`${bold ? 1 : 0}${italic ? 1 : 0}`) && !(bold === false && italic === false)) continue;
      if (seen.has(file)) continue;
      seen.add(file);
      out.push({ family, file, bold, italic });
    }
  }
  return out;
}

function usesCode(book: Book): boolean {
  const inBlocks = (blocks: Block[]): boolean =>
    blocks.some((b) => {
      if (b.kind === "code") return true;
      if (b.kind === "paragraph" || b.kind === "heading") return b.inlines.some((i) => i.kind === "text" && i.style.code);
      if (b.kind === "blockquote") return inBlocks(b.blocks);
      if (b.kind === "list") return b.items.some(inBlocks);
      return false;
    });
  return book.chapters.some((c) => inBlocks(c.blocks) || c.notes.some((n) => inBlocks(n.blocks)));
}

function bookCss(book: Book, theme: Theme, faces: { family: Family; file: FontFile; bold: boolean; italic: boolean }[], sceneGlyph: string): string {
  const size = book.settings.fontSize ?? theme.body.size;
  const base = theme.body.size;
  const lh = theme.body.leading / theme.body.size;
  const t = (ts: TextStyle) => textCss(ts, base);
  const ch = theme.chapter;
  const css: string[] = [];
  for (const f of faces) {
    css.push(`@font-face { font-family: "${f.family.name}"; src: url("../fonts/${f.file}.ttf"); font-weight: ${f.bold ? "bold" : "normal"}; font-style: ${f.italic ? "italic" : "normal"}; }`);
  }
  const justify = theme.body.justify ? "justify" : "left";
  css.push(`body { font-family: ${fontStack(theme.body.family)}; line-height: ${+lh.toFixed(3)}; }`);
  if (size !== base) css.push(`body { font-size: ${Math.round((size / base) * 100)}%; }`);
  css.push(
    `p { margin: 0; text-indent: ${theme.body.blockParagraphs ? 0 : em(theme.body.indent)}; text-align: ${justify}; -webkit-hyphens: auto; -epub-hyphens: auto; hyphens: auto; widows: 2; orphans: 2; }`,
  );
  if (theme.body.blockParagraphs) css.push("p + p { margin-top: 0.6em; }");
  if (!theme.body.hyphenate || !book.settings.hyphenate) css.push("p { -webkit-hyphens: manual; -epub-hyphens: manual; hyphens: manual; }");
  css.push("p.noindent { text-indent: 0; }");
  css.push(".lead { font-variant: small-caps; letter-spacing: 0.03em; }");
  css.push(".sc { font-variant: small-caps; }");
  const drop = theme.firstParagraph.dropCap;
  if (drop) {
    const dsize = ((drop - 1) * lh + 0.66) / 0.7;
    const dfam = theme.firstParagraph.dropCapFamily ?? theme.body.family;
    css.push(`p.opening::first-letter { float: left; font-family: ${fontStack(dfam)}; font-size: ${em(dsize)}; line-height: 0.78; margin: 0.04em 0.06em 0 0; font-weight: normal; font-style: normal; }`);
  }
  css.push("h1, h2, h3, h4, h5, h6 { -webkit-hyphens: manual; -epub-hyphens: manual; hyphens: manual; page-break-after: avoid; break-after: avoid; line-height: 1.2; }");
  css.push(`.chapter-head { margin: ${em(ch.sink * 16)} 0 ${em(ch.spaceAfter * lh)}; text-align: ${ch.title.align}; }`);
  css.push(".chapter-head h1, .part-head h1 { margin: 0; font-size: 1em; font-weight: normal; }");
  css.push(`.chapter-head .label { display: block; ${t(ch.label.style)}; margin-bottom: 0.9em; }`);
  css.push(`.chapter-head .title { display: block; ${t(ch.title)}; }`);
  css.push(`.chapter-head .subtitle { margin-top: 0.5em; text-indent: 0; text-align: ${ch.title.align}; font-family: ${fontStack(ch.title.family)}; font-size: ${em((ch.title.size * 0.6) / base)}; font-style: ${ch.title.italic ? "normal" : "italic"}; }`);
  if (ch.ornament) {
    css.push(`.chapter-head::after { display: block; ${decoration(ch.ornament.glyph)}; font-family: ${fontStack(ch.ornament.family)}; font-size: ${em(ch.ornament.size / base)}; margin-top: 0.8em; }`);
  }
  css.push(`.part-head { margin-top: 30%; text-align: center; }`);
  css.push(`.part-head .label { display: block; ${t(theme.part.label)}; margin-bottom: 1em; }`);
  css.push(`.part-head .title { display: block; ${t(theme.part.title)}; }`);
  css.push(`h2 { ${t(theme.heading2)}; text-align: ${theme.heading2.align}; margin: 1.4em 0 0.7em; }`);
  css.push(`h3, h4, h5, h6 { ${t(theme.heading3)}; text-align: ${theme.heading3.align}; margin: 1.2em 0 0.6em; }`);
  if (sceneGlyph) {
    css.push(`hr.scene { border: 0; margin: 0.9em 0; text-align: center; height: auto; overflow: visible; color: inherit; }`);
    css.push(`hr.scene::after { display: block; ${decoration(sceneGlyph)}; font-family: ${fontStack(theme.sceneBreak.family)}; font-size: ${em(theme.sceneBreak.size / base)}; line-height: 1.4; }`);
  } else {
    css.push("hr.scene { border: 0; margin: 0; height: 2em; }");
  }
  css.push(`blockquote { margin: 0.8em ${em(theme.blockquote.indent)}; }`);
  if (theme.blockquote.italic) css.push("blockquote { font-style: italic; } blockquote em { font-style: normal; }");
  css.push("ol, ul { margin: 0.6em 0; padding-left: 1.8em; } li ol, li ul { margin: 0; } li p { text-indent: 0; text-align: left; }");
  css.push("figure { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }");
  css.push("figure img { max-width: 100%; height: auto; }");
  css.push("figcaption { font-style: italic; font-size: 0.9em; margin-top: 0.4em; }");
  css.push("table { border-collapse: collapse; margin: 1em auto; font-size: 0.9em; border-top: 1px solid; border-bottom: 1px solid; }");
  css.push("th { border-bottom: 1px solid; font-weight: bold; } th, td { padding: 0.25em 0.6em; text-align: left; vertical-align: top; } .ac { text-align: center; } .ar { text-align: right; }");
  css.push(`pre { font-family: ${fontStack("inconsolata")}; font-size: 0.85em; line-height: 1.35; white-space: pre-wrap; margin: 0.8em 0; text-align: left; }`);
  css.push(`code { font-family: ${fontStack("inconsolata")}; font-size: 0.9em; } pre code { font-size: 1em; }`);
  css.push("sup, sub { font-size: 0.7em; line-height: 0; } a.noteref { text-decoration: none; }");
  css.push(".page-break { page-break-after: always; break-after: page; }");
  const tp = theme.titlePage;
  css.push(`.titlepage { margin-top: 18%; text-align: center; } .titlepage p { text-indent: 0; text-align: center; }`);
  css.push(`.titlepage h1 { ${t(tp.title)}; margin: 0; line-height: 1.15; } .titlepage .subtitle { ${t(tp.subtitle)}; margin-top: 0.8em; }`);
  css.push(`.titlepage .author { ${t(tp.author)}; margin-top: 2.5em; } .titlepage .publisher { ${t(tp.publisher)}; margin-top: 5em; }`);
  css.push(".copyright { margin-top: 3em; font-size: 0.8em; } .copyright p { text-indent: 0; text-align: left; margin: 0 0 0.7em; -webkit-hyphens: manual; -epub-hyphens: manual; hyphens: manual; }");
  css.push(".dedication { margin: 25% 10% 0; text-align: center; font-style: italic; } .dedication p { text-indent: 0; text-align: center; }");
  css.push(".epigraph { margin: 25% 10% 0; } .epigraph blockquote { margin: 0; font-style: italic; } .epigraph p { text-indent: 0; text-align: left; } .epigraph .source { text-align: right; font-style: normal; margin-top: 0.6em; }");
  css.push("body.cover { margin: 0; padding: 0; text-align: center; } .cover img { max-width: 100%; max-height: 100%; }");
  css.push(`.toc h1 { ${t(ch.title)}; text-align: ${ch.title.align}; margin: ${em(ch.sink * 10)} 0 1.5em; font-size: ${em(ch.title.size / base)}; }`);
  css.push(".toc ol { list-style: none; padding-left: 0; margin: 0; } .toc ol ol { padding-left: 1.5em; } .toc li { margin: 0.35em 0; } .toc a { text-decoration: none; color: inherit; }");
  css.push(".notes ol { padding-left: 2em; } .notes li { margin-bottom: 0.5em; } .notes li p { text-indent: 0; } a.backlink { text-decoration: none; }");
  return css.join("\n") + "\n";
}

// ── Package ────────────────────────────────────────────────────

function hashUuid(s: string): string {
  const words: number[] = [];
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    words.push(h);
  }
  const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isbnDigits(isbn: string): string {
  return isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function w3cDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface XDoc {
  id: string;
  /** Relative to the EPUB folder. */
  href: string;
  content: string;
  linear: boolean;
  /** "nav" for the navigation document. */
  properties?: string;
}

interface NavEntry {
  label: string;
  href: string;
  children: NavEntry[];
}

export async function writeEpub(book: Book, opts: EpubOptions): Promise<Uint8Array> {
  const { meta, settings } = book;
  const theme = themeById(settings.theme);
  const lang = meta.language || "en";
  const s = strings(lang);
  const pack = opts.accessiblePack;
  const sceneGlyph = settings.sceneBreak ?? theme.sceneBreak.glyph;

  const front = book.chapters.filter((c) => c.matter === "front");
  const body = book.chapters.filter((c) => c.matter === "body");
  const back = book.chapters.filter((c) => c.matter === "back");
  const withNotes = book.chapters.filter((c) => c.notes.length);
  const hasCover = !!(meta.cover?.path && book.images.has(meta.cover.path));

  // Images get stable, safe names.
  const imageHref = new Map<string, string>();
  const used = new Set<string>();
  for (const [path, asset] of book.images) {
    const ext = asset.mime === "image/png" ? "png" : "jpg";
    const stem = (path.split("/").pop() ?? "image").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
    let name = `${stem}.${ext}`;
    for (let n = 2; used.has(name); n++) name = `${stem}-${n}.${ext}`;
    used.add(name);
    imageHref.set(path, `images/${name}`);
  }

  // Everything a print page can start at, so page markers land in the right place.
  const anchors = new Set<string>(["titlepage", "copyright"]);
  if (meta.dedication) anchors.add("dedication");
  if (meta.epigraph) anchors.add("epigraph");
  if (settings.toc) anchors.add("toc");
  for (const c of book.chapters) {
    anchors.add(c.id);
    collectIds(c.blocks, anchors);
    for (const n of c.notes) {
      anchors.add(n.id);
      collectIds(n.blocks, anchors);
    }
  }
  if (withNotes.length) {
    anchors.add(NOTES_ID);
    for (const c of withNotes) anchors.add(notesHeadingId(c.id));
  }
  const markers = new PageMarkers(pack ? opts.layout : undefined, anchors);

  const noteNumber = new Map<string, number>();
  for (const c of book.chapters) for (const n of c.notes) noteNumber.set(n.id, n.number);
  const ctx: WriterCtx = { book, theme, lang, markers, imageHref, noteNumber, refCount: new Map(), refDoc: new Map(), sceneGlyph };

  const docs: XDoc[] = [];
  const page = (id: string, file: string, title: string, inner: string, o: { matter?: Matter; bodyClass?: string; linear?: boolean } = {}) => {
    docs.push({ id, href: `text/${file}`, content: xhtml(title, lang, inner, { ...o, cssHref: "../css/book.css" }), linear: o.linear ?? true });
  };
  const section = (attrs: { id: string; type?: string; role?: string; labelledBy?: string; cls?: string }) =>
    `<section id="${attrs.id}"${attrs.type ? ` epub:type="${attrs.type}"` : ""}${attrs.role ? ` role="${attrs.role}"` : ""}${attrs.labelledBy ? ` aria-labelledby="${attrs.labelledBy}"` : ""}${attrs.cls ? ` class="${attrs.cls}"` : ""}>`;

  // ── Front matter ──
  if (hasCover) {
    markers.href = "text/cover.xhtml";
    const alt = meta.cover!.alt || `Cover of ${meta.title}`;
    page("cover", "cover.xhtml", meta.title, `${section({ id: "cover", type: "cover" })}\n<img src="../${imageHref.get(meta.cover!.path)}" alt="${esc(alt)}" role="doc-cover"/>\n</section>\n`, { matter: "front", bodyClass: "cover" });
  }
  markers.href = "text/titlepage.xhtml";
  {
    let inner = `${section({ id: "titlepage", type: "titlepage", cls: "titlepage", labelledBy: "book-title" })}\n${markers.before("titlepage")}<h1 id="book-title">${esc(meta.title)}</h1>\n`;
    if (meta.subtitle) inner += `<p class="subtitle">${esc(meta.subtitle)}</p>\n`;
    if (meta.authors.length) inner += `<p class="author">${esc(meta.authors.join(", "))}</p>\n`;
    if (meta.publisher) inner += `<p class="publisher">${esc(meta.publisher)}</p>\n`;
    page("titlepage", "titlepage.xhtml", meta.title, inner + "</section>\n", { matter: "front" });
  }
  markers.href = "text/copyright.xhtml";
  {
    const lines: string[] = [];
    lines.push(esc(meta.subtitle ? `${meta.title}: ${meta.subtitle}` : meta.title) + (meta.authors.length ? `<br/>${esc(meta.authors.join(", "))}` : ""));
    if (meta.copyright) lines.push(meta.copyright.split("\n").map(esc).join("<br/>"));
    if (meta.edition) lines.push(esc(meta.edition));
    const isbn = meta.isbnEbook ?? meta.isbnPrint;
    if (isbn) lines.push(`ISBN ${esc(isbn)}${meta.isbnEbook ? " (ebook)" : " (print)"}`);
    if (meta.publisher) lines.push(esc(lang.startsWith("es") ? `Publicado por ${meta.publisher}` : meta.publisher));
    const inner = `${section({ id: "copyright", type: "copyright-page", cls: "copyright" })}\n${markers.before("copyright")}${lines.map((l) => `<p>${l}</p>`).join("\n")}\n</section>\n`;
    page("copyright", "copyright.xhtml", `${meta.title}: copyright`, inner, { matter: "front" });
  }
  if (meta.dedication) {
    markers.href = "text/dedication.xhtml";
    const paras = meta.dedication.trim().split(/\n/).map(esc).join("<br/>");
    page("dedication", "dedication.xhtml", `${meta.title}: dedication`, `${section({ id: "dedication", type: "dedication", role: "doc-dedication", cls: "dedication" })}\n${markers.before("dedication")}<p>${paras}</p>\n</section>\n`, { matter: "front" });
  }
  if (meta.epigraph) {
    markers.href = "text/epigraph.xhtml";
    const quote = meta.epigraph.trim().split(/\n/).map(esc).join("<br/>");
    const source = meta.epigraphSource ? `<p class="source">— ${esc(meta.epigraphSource)}</p>` : "";
    page("epigraph", "epigraph.xhtml", `${meta.title}: epigraph`, `${section({ id: "epigraph", type: "epigraph", role: "doc-epigraph", cls: "epigraph" })}\n${markers.before("epigraph")}<blockquote><p>${quote}</p>${source}</blockquote>\n</section>\n`, { matter: "front" });
  }
  // The navigation document sits where the printed contents do; it is written last, once the page list is known.
  const navIndex = docs.length;
  let navMarkers = "";
  if (settings.toc) {
    markers.href = "nav.xhtml";
    navMarkers = markers.before("toc");
  }

  // ── Chapters ──
  const chapterDoc = (ch: Chapter) => {
    const file = `${ch.id}.xhtml`;
    markers.href = `text/${file}`;
    const sem = SECTION[ch.type];
    const titleId = `${ch.id}-title`;
    let head: string;
    if (ch.type === "part") {
      const { label } = partHeading(ch, lang);
      head = `<header class="part-head"><h1 id="${titleId}">${label ? `<span class="label">${esc(label)}</span> ` : ""}<span class="title">${renderInlines(ctx, ch.title)}</span></h1></header>\n`;
    } else {
      const label = ch.number !== undefined && theme.chapter.label.show ? chapterLabel(ch.number, lang, theme.chapter.label.format, theme.chapter.label.prefix) : null;
      const subtitle = ch.subtitle ? `\n<p class="subtitle">${esc(ch.subtitle)}</p>` : "";
      head = `<header class="chapter-head"><h1 id="${titleId}">${label ? `<span class="label">${esc(label)}</span> ` : ""}<span class="title">${renderInlines(ctx, ch.title)}</span></h1>${subtitle}</header>\n`;
    }
    const opening = ch.matter === "body" || ch.type === "prologue";
    const state: ParaState = { noIndent: true, leadIn: theme.firstParagraph.leadInWords, dropCap: opening && theme.firstParagraph.dropCap > 0 };
    const inner = `${section({ id: ch.id, type: sem.type, role: sem.role, labelledBy: titleId })}\n${markers.before(ch.id)}${head}${renderBlocks(ctx, ch.blocks, state, false)}</section>\n`;
    page(ch.id, file, ch.titleText || meta.title, inner, { matter: ch.matter });
  };
  front.forEach(chapterDoc);
  body.forEach(chapterDoc);
  back.forEach(chapterDoc);

  // ── Endnotes ──
  if (withNotes.length) {
    markers.href = "text/notes.xhtml";
    let inner = `${section({ id: NOTES_ID, type: "endnotes", role: "doc-endnotes", labelledBy: "notes-title", cls: "notes" })}\n${markers.before(NOTES_ID)}<header class="chapter-head"><h1 id="notes-title"><span class="title">${esc(s.notes)}</span></h1></header>\n`;
    for (const ch of withNotes) {
      const hid = notesHeadingId(ch.id);
      const heading = ch.number !== undefined ? `${chapterLabel(ch.number, lang, "numeral", true)}. ${ch.titleText}` : ch.titleText;
      inner += `<section id="${hid}" aria-labelledby="${hid}-h">\n${markers.before(hid)}<h2 id="${hid}-h">${esc(heading)}</h2>\n<ol>\n`;
      for (const n of ch.notes) {
        const refDoc = ctx.refDoc.get(n.id);
        const back = refDoc ? `<a class="backlink" href="${refDoc.replace(/^text\//, "")}#${n.id}-ref" role="doc-backlink" aria-label="Back to the text of note ${n.number}">↩</a>` : "";
        let content = renderBlocks(ctx, n.blocks, { noIndent: true, leadIn: 0, dropCap: false }, true).trim();
        if (back) content = content.endsWith("</p>") ? `${content.slice(0, -4)} ${back}</p>` : `${content}\n<p>${back}</p>`;
        inner += `<li id="${n.id}" epub:type="endnote">${markers.before(n.id)}${content}</li>\n`;
      }
      inner += "</ol>\n</section>\n";
    }
    inner += markers.before(END);
    page("notes", "notes.xhtml", s.notes, inner + "</section>\n", { matter: "back" });
  } else if (docs.length) {
    // Pages after the last anchor (trailing blanks) go at the end of the last document.
    const tail = markers.before(END);
    if (tail) {
      const last = docs[docs.length - 1];
      last.content = last.content.replace(/<\/section>\n<\/body>/, `${tail}</section>\n</body>`);
    }
  }

  // ── Navigation ──
  const docHref = (ch: Chapter) => `text/${ch.id}.xhtml`;
  const tocLabel = (ch: Chapter) => (ch.type === "part" ? partHeading(ch, lang).full : ch.number !== undefined ? `${ch.number}. ${ch.titleText}` : ch.titleText);
  const navTree: NavEntry[] = [];
  for (const ch of front) navTree.push({ label: tocLabel(ch), href: docHref(ch), children: [] });
  let currentPart: NavEntry | null = null;
  for (const ch of body) {
    if (ch.type === "part") {
      currentPart = { label: tocLabel(ch), href: docHref(ch), children: [] };
      navTree.push(currentPart);
    } else (currentPart ? currentPart.children : navTree).push({ label: tocLabel(ch), href: docHref(ch), children: [] });
  }
  for (const ch of back) navTree.push({ label: tocLabel(ch), href: docHref(ch), children: [] });
  if (withNotes.length) navTree.push({ label: s.notes, href: "text/notes.xhtml", children: [] });

  const navList = (entries: NavEntry[], depth: number): string => {
    const pad = "  ".repeat(depth);
    return `${pad}<ol>\n${entries.map((e) => `${pad}  <li><a href="${e.href}">${esc(e.label || meta.title)}</a>${e.children.length ? "\n" + navList(e.children, depth + 2) + pad + "  " : ""}</li>\n`).join("")}${pad}</ol>\n`;
  };
  const landmarks: [string, string, string][] = [];
  if (hasCover) landmarks.push(["cover", "text/cover.xhtml", "Cover"]);
  landmarks.push(["titlepage", "text/titlepage.xhtml", "Title page"]);
  if (settings.toc) landmarks.push(["toc", "nav.xhtml#toc", s.contents]);
  const firstBody = body[0] ?? back[0] ?? front[0];
  if (firstBody) landmarks.push(["bodymatter", docHref(firstBody), "Start of content"]);
  if (withNotes.length) landmarks.push(["endnotes", "text/notes.xhtml", s.notes]);

  let navBody = `${navMarkers}<nav epub:type="toc" id="toc" role="doc-toc" class="toc">\n<h1 id="toc-title">${esc(s.contents)}</h1>\n${navList(navTree, 0)}</nav>\n`;
  navBody += `<nav epub:type="landmarks" id="landmarks" hidden="hidden">\n<ol>\n${landmarks.map(([type, href, label]) => `  <li><a epub:type="${type}" href="${href}">${esc(label)}</a></li>\n`).join("")}</ol>\n</nav>\n`;
  const pageList = markers.written;
  if (pageList.length) {
    navBody += `<nav epub:type="page-list" id="page-list" hidden="hidden">\n<ol>\n${pageList.map((p) => `  <li><a href="${p.href === "nav.xhtml" ? "" : p.href}#page-${esc(p.label)}">${esc(p.label)}</a></li>\n`).join("")}</ol>\n</nav>\n`;
  }
  const navDoc: XDoc = { id: "nav", href: "nav.xhtml", content: xhtml(s.contents, lang, navBody, { matter: "front", cssHref: "css/book.css" }), linear: settings.toc, properties: "nav" };
  docs.splice(navIndex, 0, navDoc);

  // ── Package document ──
  const identifier = meta.isbnEbook ? `urn:isbn:${isbnDigits(meta.isbnEbook)}` : `urn:uuid:${hashUuid([meta.title, meta.subtitle ?? "", meta.authors.join(";"), meta.publisher ?? "", meta.edition ?? ""].join("|"))}`;
  const modified = w3cDate(opts.modified ?? new Date());
  const md: string[] = [];
  md.push(`<dc:identifier id="pub-id">${esc(identifier)}</dc:identifier>`);
  md.push(`<dc:title id="title">${esc(meta.title)}</dc:title>`, `<meta refines="#title" property="title-type">main</meta>`);
  if (meta.subtitle) md.push(`<dc:title id="subtitle">${esc(meta.subtitle)}</dc:title>`, `<meta refines="#subtitle" property="title-type">subtitle</meta>`);
  meta.authors.forEach((a, i) => md.push(`<dc:creator id="creator${i + 1}">${esc(a)}</dc:creator>`, `<meta refines="#creator${i + 1}" property="role" scheme="marc:relators">aut</meta>`));
  md.push(`<dc:language>${esc(lang)}</dc:language>`);
  if (meta.publisher) md.push(`<dc:publisher>${esc(meta.publisher)}</dc:publisher>`);
  if (meta.year && /^\d{4}$/.test(meta.year)) md.push(`<dc:date>${meta.year}</dc:date>`);
  if (meta.description) md.push(`<dc:description>${esc(meta.description)}</dc:description>`);
  for (const subj of meta.subjects) md.push(`<dc:subject>${esc(subj)}</dc:subject>`);
  if (meta.copyright) md.push(`<dc:rights>${esc(meta.copyright)}</dc:rights>`);
  md.push(`<meta property="dcterms:modified">${modified}</meta>`);
  if (meta.series) {
    md.push(`<meta property="belongs-to-collection" id="series">${esc(meta.series)}</meta>`, `<meta refines="#series" property="collection-type">series</meta>`);
    if (meta.seriesNumber) md.push(`<meta refines="#series" property="group-position">${meta.seriesNumber}</meta>`);
  }
  if (pageList.length) {
    const source = meta.isbnPrint ? `urn:isbn:${isbnDigits(meta.isbnPrint)}` : `${meta.title} (print edition)`;
    md.push(`<dc:source id="print-source">${esc(source)}</dc:source>`, `<meta refines="#print-source" property="source-of">pagination</meta>`);
  }
  if (pack && opts.audit) {
    const a = opts.audit;
    for (const v of a.accessMode) md.push(`<meta property="schema:accessMode">${v}</meta>`);
    for (const v of a.accessModeSufficient) md.push(`<meta property="schema:accessModeSufficient">${v}</meta>`);
    const features = [...a.accessibilityFeature];
    if (pageList.length) for (const f of ["printPageNumbers", "pageNavigation"]) if (!features.includes(f)) features.push(f);
    for (const v of features) md.push(`<meta property="schema:accessibilityFeature">${v}</meta>`);
    for (const v of a.accessibilityHazard) md.push(`<meta property="schema:accessibilityHazard">${v}</meta>`);
    md.push(`<meta property="schema:accessibilitySummary">${esc(meta.accessibilitySummary ?? a.summary)}</meta>`);
    if (a.passed && opts.claimConformance) {
      const certifier = opts.certifiedBy ?? meta.publisher ?? meta.authors.join(", ");
      md.push(`<meta property="dcterms:conformsTo" id="conformance">${CONFORMS_TO}</meta>`);
      if (certifier) md.push(`<meta property="a11y:certifiedBy" refines="#conformance">${esc(certifier)}</meta>`);
    }
  }
  if (hasCover) md.push(`<meta name="cover" content="cover-image"/>`);
  if (opts.generator) md.push(`<meta name="generator" content="${esc(opts.generator)}"/>`);

  const faces = opts.fonts ? themeFonts(theme, book).filter((f) => opts.fonts!.bytes.has(f.file)) : [];
  const items: string[] = [];
  items.push(`<item id="css" href="css/book.css" media-type="text/css"/>`);
  items.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  for (const d of docs) items.push(`<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"${d.properties ? ` properties="${d.properties}"` : ""}/>`);
  let imgN = 0;
  for (const [path, href] of imageHref) {
    const asset = book.images.get(path)!;
    const isCover = hasCover && path === meta.cover!.path;
    items.push(`<item id="${isCover ? "cover-image" : `img${++imgN}`}" href="${href}" media-type="${asset.mime}"${isCover ? ' properties="cover-image"' : ""}/>`);
  }
  faces.forEach((f, i) => items.push(`<item id="font${i + 1}" href="fonts/${f.file}.ttf" media-type="font/ttf"/>`));
  const spine = docs.filter((d) => d.properties !== "nav" || d.linear).map((d) => `<itemref idref="${d.id}"${d.linear ? "" : ' linear="no"'}/>`);

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${esc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${md.map((l) => "  " + l).join("\n")}
</metadata>
<manifest>
${items.map((l) => "  " + l).join("\n")}
</manifest>
<spine toc="ncx">
${spine.map((l) => "  " + l).join("\n")}
</spine>
</package>
`;

  // ── NCX for older reading systems ──
  let playOrder = 0;
  const ncxPoints = (entries: NavEntry[], depth: number): string =>
    entries
      .map((e) => {
        const pad = "  ".repeat(depth);
        const n = ++playOrder;
        return `${pad}<navPoint id="np${n}" playOrder="${n}"><navLabel><text>${esc(e.label || meta.title)}</text></navLabel><content src="${e.href}"/>${e.children.length ? "\n" + ncxPoints(e.children, depth + 1) + "\n" + pad : ""}</navPoint>`;
      })
      .join("\n");
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${esc(lang)}">
<head>
  <meta name="dtb:uid" content="${esc(identifier)}"/>
  <meta name="dtb:depth" content="${navTree.some((e) => e.children.length) ? 2 : 1}"/>
  <meta name="dtb:totalPageCount" content="0"/>
  <meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${esc(meta.title)}</text></docTitle>
<navMap>
${ncxPoints(navTree.length ? navTree : [{ label: meta.title, href: "text/titlepage.xhtml", children: [] }], 1)}
</navMap>
</ncx>
`;

  const zip = new JSZip();
  const date = opts.modified ?? new Date();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE", date });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
    { date },
  );
  zip.file("EPUB/package.opf", opf, { date });
  zip.file("EPUB/toc.ncx", ncx, { date });
  zip.file("EPUB/css/book.css", bookCss(book, theme, faces, sceneGlyph), { date });
  for (const d of docs) zip.file(`EPUB/${d.href}`, d.content, { date });
  for (const [path, href] of imageHref) zip.file(`EPUB/${href}`, book.images.get(path)!.bytes, { date, compression: "STORE" });
  for (const f of faces) zip.file(`EPUB/fonts/${f.file}.ttf`, opts.fonts!.bytes.get(f.file)!, { date });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 }, mimeType: "application/epub+zip" });
}

/** A file name for the book's outputs: "The Wonderful Wizard of Oz" → "the-wonderful-wizard-of-oz". */
export function bookSlug(book: Book): string {
  return (
    book.meta.title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "book"
  );
}
