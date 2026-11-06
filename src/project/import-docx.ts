// Turns a Word (.docx) manuscript into a book (C2 of the app plan).
// A .docx is a zip of XML files. We read the text, the headings, bold and italic, lists, quotes,
// footnotes, links, page breaks and pictures, write them as Markdown, and hand that to the same
// chapter splitter that imports .md and .txt files. Whatever cannot be kept (tables, text boxes,
// comments, equations…) is left out and listed in the report, so nothing disappears silently.
//
// Pure code: the caller gives the XML parser (the browser's DOMParser; tests use xmldom).

import JSZip from "jszip";
import { importText, type ImportedBook } from "./import-text";
import type { ProjectAsset } from "./model";

export type ParseXml = (xml: string) => Document;

/** What was left out or worth a look. Codes are turned into sentences by the screen. */
export type ReportCode = "tables" | "textBoxes" | "equations" | "comments" | "deletions" | "insertions" | "toc" | "oldPictures" | "unsupportedImages" | "imagesNoAlt";

export interface DocxReport {
  /** Each code with how many times it happened (only those that did). */
  items: { code: ReportCode; count: number }[];
  chapters: number;
  images: number;
  footnotes: number;
}

export interface ImportedDocx extends ImportedBook {
  assets: ProjectAsset[];
  report: DocxReport;
  /** The Markdown the chapters were cut from (useful for tests and for debugging). */
  markdown: string;
}

export const MAX_DOCX_BYTES = 40 * 1024 * 1024;
const MAX_PART_BYTES = 60 * 1024 * 1024;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const PAGE_BREAK = "<!-- pagebreak -->";

type El = Element;

const kids = (e: El): El[] => Array.from(e.childNodes).filter((n): n is El => n.nodeType === 1);
const child = (e: El | null | undefined, name: string): El | null => (e ? (kids(e).find((k) => k.localName === name && k.namespaceURI === W) ?? null) : null);
const attr = (e: El | null | undefined, name: string): string | null => (e ? (e.getAttributeNS(W, name) ?? e.getAttribute(`w:${name}`)) : null);
/** A toggle such as <w:b/> is on unless it says val="0" or "false". */
const on = (e: El | null): boolean => !!e && !["0", "false", "off"].includes((attr(e, "val") ?? "").toLowerCase());

interface Seg {
  text: string;
  b: boolean;
  i: boolean;
}

interface Ctx {
  parse: ParseXml;
  styles: Map<string, string>;
  numbering: Map<string, boolean>; // "numId:ilvl" → ordered?
  rels: Map<string, string>;
  zip: JSZip;
  footnotes: Map<string, El>;
  noteOrder: Map<string, number>;
  assets: ProjectAsset[];
  imageNames: Map<string, string>;
  counts: Map<ReportCode, number>;
  pendingNotes: string[];
  inNote: boolean;
  pendingImages: { asset: ProjectAsset; path: string }[];
}

const bump = (c: Ctx, code: ReportCode, n = 1): void => void c.counts.set(code, (c.counts.get(code) ?? 0) + n);

async function textOf(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  if (!f) return null;
  const text = await f.async("string");
  if (text.length > MAX_PART_BYTES) throw new Error("docx.tooBig");
  return text;
}

function readStyles(doc: Document | null): { names: Map<string, string>; lang?: string } {
  const names = new Map<string, string>();
  let lang: string | undefined;
  if (!doc) return { names };
  for (const s of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
    const id = attr(s, "styleId");
    const name = attr(child(s, "name"), "val");
    if (id && name) names.set(id, name.toLowerCase());
  }
  const defaults = doc.getElementsByTagNameNS(W, "docDefaults")[0];
  lang = attr(child(child(child(defaults, "rPrDefault"), "rPr"), "lang"), "val") ?? undefined;
  return { names, lang };
}

function readNumbering(doc: Document | null): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!doc) return out;
  const abstracts = new Map<string, Map<string, boolean>>();
  for (const a of Array.from(doc.getElementsByTagNameNS(W, "abstractNum"))) {
    const levels = new Map<string, boolean>();
    for (const l of kids(a).filter((k) => k.localName === "lvl")) levels.set(attr(l, "ilvl") ?? "0", (attr(child(l, "numFmt"), "val") ?? "bullet") !== "bullet" && attr(child(l, "numFmt"), "val") !== "none");
    abstracts.set(attr(a, "abstractNumId") ?? "", levels);
  }
  for (const n of Array.from(doc.getElementsByTagNameNS(W, "num"))) {
    const levels = abstracts.get(attr(child(n, "abstractNumId"), "val") ?? "");
    if (levels) for (const [lvl, ordered] of levels) out.set(`${attr(n, "numId")}:${lvl}`, ordered);
  }
  return out;
}

function readRels(doc: Document | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!doc) return out;
  for (const r of Array.from(doc.getElementsByTagName("Relationship"))) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target");
    if (id && target) out.set(id, r.getAttribute("TargetMode") === "External" ? target : `${r.getAttribute("TargetMode") ?? ""}|${target}`);
  }
  return out;
}

// ── Text of a paragraph ──

const MARKDOWN_SPECIAL = /([\\*_[\]<>`])/g;
const escapeText = (s: string): string => s.replace(MARKDOWN_SPECIAL, "\\$1");

function imageFor(c: Ctx, drawing: El): string {
  const blip = drawing.getElementsByTagNameNS(A, "blip")[0];
  const id = blip?.getAttributeNS(R, "embed") ?? blip?.getAttribute("r:embed");
  const rel = id ? c.rels.get(id) : undefined;
  if (!rel) return "";
  const target = rel.split("|").pop() ?? "";
  const path = target.startsWith("/") ? target.slice(1) : `word/${target}`.replace(/\/\.\//g, "/");
  const cached = c.imageNames.get(path);
  const props = drawing.getElementsByTagNameNS(WP, "docPr")[0];
  const alt = (props?.getAttribute("descr") || props?.getAttribute("title") || "").replace(/[\r\n[\]]+/g, " ").trim();
  if (!alt) bump(c, "imagesNoAlt");
  if (cached !== undefined) return cached ? `![${alt}](<${cached}>)` : "";
  const ext = /\.(png|jpe?g)$/i.exec(path)?.[1]?.toLowerCase();
  if (!ext) {
    bump(c, "unsupportedImages");
    c.imageNames.set(path, "");
    return "";
  }
  const name = `docx-image-${c.assets.length + 1}.${ext === "jpeg" ? "jpg" : ext}`;
  c.imageNames.set(path, name);
  c.assets.push({ name, mime: ext === "png" ? "image/png" : "image/jpeg", data: new Uint8Array(0) });
  c.pendingImages.push({ asset: c.assets[c.assets.length - 1], path });
  return `![${alt}](<${name}>)`;
}

function runSegments(c: Ctx, p: El, out: Seg[], fmt = { b: false, i: false }): void {
  for (const node of kids(p)) {
    const n = node.localName;
    if (n === "r") {
      const rpr = child(node, "rPr");
      const b = fmt.b || on(child(rpr, "b"));
      const i = fmt.i || on(child(rpr, "i"));
      for (const part of kids(node)) {
        const k = part.localName;
        if (k === "t") out.push({ text: part.textContent ?? "", b, i });
        else if (k === "tab") out.push({ text: " ", b, i });
        else if (k === "noBreakHyphen") out.push({ text: "-", b, i });
        else if (k === "sym") out.push({ text: "", b, i });
        else if (k === "br") {
          const type = attr(part, "type");
          if (type === "page") out.push({ text: `\uE000PB`, b: false, i: false });
          else if (!type || type === "textWrapping") out.push({ text: "\uE000BR", b: false, i: false });
        } else if (k === "drawing") out.push({ text: `\uE000RAW${imageFor(c, part)}\uE000`, b: false, i: false });
        else if (k === "pict" || k === "object") bump(c, "oldPictures");
        else if (k === "footnoteReference" || k === "endnoteReference") {
          const id = attr(part, "id") ?? "";
          const note = c.footnotes.get(`${k}:${id}`);
          if (note && !c.inNote) {
            if (!c.noteOrder.has(`${k}:${id}`)) c.noteOrder.set(`${k}:${id}`, c.noteOrder.size + 1);
            const num = c.noteOrder.get(`${k}:${id}`) ?? 0;
            out.push({ text: `\uE000RAW[^${num}]\uE000`, b: false, i: false });
            c.pendingNotes.push(`${num}\uE000${noteText(c, note)}`);
          }
        } else if (k === "commentReference") bump(c, "comments");
      }
    } else if (n === "hyperlink") {
      const id = node.getAttributeNS(R, "id") ?? node.getAttribute("r:id");
      const target = id ? c.rels.get(id) : undefined;
      const url = target && !target.includes("|") ? target : null;
      const inner: Seg[] = [];
      runSegments(c, node, inner, fmt);
      if (url && /^(https?:|mailto:)/i.test(url)) {
        out.push({ text: "\uE000RAW[\uE000", b: false, i: false }, ...inner, { text: `\uE000RAW](<${url}>)\uE000`, b: false, i: false });
      } else out.push(...inner);
    } else if (n === "ins" || n === "smartTag" || n === "sdt" || n === "fldSimple" || n === "sdtContent") {
      if (n === "ins") bump(c, "insertions");
      runSegments(c, n === "sdt" ? (child(node, "sdtContent") ?? node) : node, out, fmt);
    } else if (n === "del") bump(c, "deletions");
    else if (n === "oMath" || n === "oMathPara") bump(c, "equations");
  }
}

function noteText(c: Ctx, note: El): string {
  const saved = c.inNote;
  c.inNote = true;
  const parts = kids(note)
    .filter((k) => k.localName === "p")
    .map((p) => render(c, paragraphSegs(c, p)).replace(/\n+/g, " ").trim())
    .filter(Boolean);
  c.inNote = saved;
  return parts.join(" ");
}

function paragraphSegs(c: Ctx, p: El): Seg[] {
  const segs: Seg[] = [];
  runSegments(c, p, segs);
  return segs;
}

/** Join segments into Markdown: adjacent text with the same bold/italic shares one pair of marks. */
function render(c: Ctx, segs: Seg[]): string {
  void c;
  const merged: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.b === s.b && last.i === s.i && !s.text.startsWith("\uE000") && !last.text.endsWith("\uE000")) last.text += s.text;
    else merged.push({ ...s });
  }
  let out = "";
  for (const s of merged) {
    if (s.text === "\uE000PB") {
      out += "\uE000PB\uE000";
      continue;
    }
    if (s.text === "\uE000BR") {
      out += "  \n";
      continue;
    }
    const raw = /^\uE000RAW([\s\S]*)\uE000$/.exec(s.text);
    if (raw) {
      out += raw[1];
      continue;
    }
    const lead = /^\s*/.exec(s.text)?.[0] ?? "";
    const tail = s.text.length > lead.length ? (/\s*$/.exec(s.text)?.[0] ?? "") : "";
    const core = s.text.slice(lead.length, s.text.length - tail.length);
    const mark = s.b && s.i ? "***" : s.b ? "**" : s.i ? "*" : "";
    out += core ? `${lead}${mark}${escapeText(core)}${mark}${tail}` : lead + tail;
  }
  return out.replace(/ {3,}\n/g, "  \n");
}

const SCENE = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|#|[⁂❦])\s*$/;
const LEADING = /^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/;

interface Block {
  kind: "heading" | "paragraph" | "quote" | "list" | "pageBreak" | "skip";
  level?: number;
  text: string;
  ordered?: boolean;
  depth?: number;
  title?: boolean;
  subtitle?: boolean;
  author?: boolean;
}

function paragraphBlock(c: Ctx, p: El): Block[] {
  const ppr = child(p, "pPr");
  const styleId = attr(child(ppr, "pStyle"), "val") ?? "";
  const style = c.styles.get(styleId) ?? styleId.toLowerCase();
  const segs = paragraphSegs(c, p);
  const pbefore = on(child(ppr, "pageBreakBefore"));
  const blocks: Block[] = [];
  if (pbefore) blocks.push({ kind: "pageBreak", text: "" });

  // A page break inside a paragraph splits it into text, a page break, text.
  const pieces: Seg[][] = [[]];
  const breaks: boolean[] = [];
  for (const s of segs) {
    if (s.text === "\uE000PB") {
      pieces.push([]);
      breaks.push(true);
    } else pieces[pieces.length - 1].push(s);
  }

  if (/^(toc|table of contents|contents|índice|tabla de contenido)/i.test(style) || /^toc\s*\d/i.test(style)) {
    bump(c, "toc");
    return [{ kind: "skip", text: "" }];
  }

  pieces.forEach((piece, idx) => {
    if (idx > 0) blocks.push({ kind: "pageBreak", text: "" });
    const text = render(c, piece).trim();
    if (!text) return;
    const heading = /^heading\s*(\d)$/i.exec(style) ?? /^t[ií]tulo\s*(\d)$/i.exec(style);
    const outline = attr(child(ppr, "outlineLvl"), "val");
    const level = heading ? Number(heading[1]) : outline !== null && /^\d$/.test(outline) && Number(outline) < 6 ? Number(outline) + 1 : 0;
    if (level) return void blocks.push({ kind: "heading", level, text: text.replace(/\*+/g, "").replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\s+/g, " ").trim() });
    if (style === "title" || style === "título") return void blocks.push({ kind: "paragraph", text, title: true });
    if (style === "author" || style === "autor") return void blocks.push({ kind: "paragraph", text, author: true });
    if (style === "date" || style === "fecha") return void blocks.push({ kind: "skip", text: "" });
    if (style === "subtitle" || style === "subtítulo") return void blocks.push({ kind: "paragraph", text, subtitle: true });
    const num = child(ppr, "numPr");
    const numId = attr(child(num, "numId"), "val");
    if ((num && numId && numId !== "0") || /^list (bullet|number|paragraph)|^lista/i.test(style)) {
      const ilvl = attr(child(num, "ilvl"), "val") ?? "0";
      const ordered = numId ? (c.numbering.get(`${numId}:${ilvl}`) ?? /number/i.test(style)) : /number/i.test(style);
      return void blocks.push({ kind: "list", text, ordered, depth: Number(ilvl) || 0 });
    }
    if (/quote|cita|block text|texto en bloque/i.test(style)) return void blocks.push({ kind: "quote", text });
    blocks.push({ kind: "paragraph", text });
  });
  void breaks;
  return blocks;
}

function lineSafe(text: string): string {
  return SCENE.test(text.replace(/\\\*/g, "*")) ? "* * *" : text.replace(LEADING, (_m, sp: string, mark: string) => `${sp}\\${mark}`);
}

/** Read the .docx and give back chapters, pictures and a report. */
export async function importDocx(bytes: Uint8Array, parse: ParseXml, fileName = ""): Promise<ImportedDocx> {
  if (bytes.byteLength > MAX_DOCX_BYTES) throw new Error("docx.tooBig");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("docx.notDocx");
  }
  const mainXml = await textOf(zip, "word/document.xml");
  if (!mainXml) throw new Error("docx.notDocx");
  const xml = async (path: string): Promise<Document | null> => {
    const t = await textOf(zip, path);
    return t ? parse(t) : null;
  };
  const doc = parse(mainXml);
  const { names, lang } = readStyles(await xml("word/styles.xml"));
  const footnotes = new Map<string, El>();
  for (const [part, tag, key] of [["word/footnotes.xml", "footnote", "footnoteReference"], ["word/endnotes.xml", "endnote", "endnoteReference"]] as const) {
    const d = await xml(part);
    if (d) for (const n of Array.from(d.getElementsByTagNameNS(W, tag))) if (!attr(n, "type") || attr(n, "type") === "normal") footnotes.set(`${key}:${attr(n, "id")}`, n);
  }
  const c: Ctx = {
    parse,
    styles: names,
    numbering: readNumbering(await xml("word/numbering.xml")),
    rels: readRels(await xml("word/_rels/document.xml.rels")),
    zip,
    footnotes,
    noteOrder: new Map(),
    assets: [],
    imageNames: new Map(),
    counts: new Map(),
    pendingNotes: [],
    inNote: false,
    pendingImages: [],
  };
  if (zip.file("word/comments.xml")) bump(c, "comments", 0);

  // Walk the body in order.
  const blocks: Block[] = [];
  const notesAfter: Map<number, string[]> = new Map();
  const walk = (parent: El): void => {
    for (const node of kids(parent)) {
      const n = node.localName;
      if (n === "p") {
        c.pendingNotes = [];
        const found = paragraphBlock(c, node);
        blocks.push(...found);
        if (c.pendingNotes.length && found.length) notesAfter.set(blocks.length - 1, [...c.pendingNotes]);
        if (node.getElementsByTagNameNS(W, "txbxContent").length) bump(c, "textBoxes");
      } else if (n === "tbl") bump(c, "tables");
      else if (n === "sdt") walk(child(node, "sdtContent") ?? node);
      else if (n === "customXml" || n === "ins") walk(node);
    }
  };
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("docx.notDocx");
  walk(body);

  // Which heading level starts a chapter: the highest one the document uses (1, 2 or 3).
  const levels = blocks.filter((b) => b.kind === "heading").map((b) => b.level ?? 1);
  const top = levels.length ? Math.min(...levels) : 1;

  const lines: string[] = [];
  let title: string | undefined;
  let subtitle: string | undefined;
  let author: string | undefined;
  blocks.forEach((b, idx) => {
    const extra = notesAfter.get(idx);
    if (b.kind === "skip") return;
    if (b.kind === "pageBreak") lines.push(PAGE_BREAK, "");
    else if (b.kind === "heading") lines.push(`${"#".repeat(Math.min(4, Math.max(1, (b.level ?? 1) - top + 1)))} ${b.text}`, "");
    else if (b.title) title ??= b.text.replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\*+/g, "");
    else if (b.author) author ??= b.text.replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\*+/g, "");
    else if (b.subtitle) subtitle ??= b.text.replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\*+/g, "");
    else if (b.kind === "quote") lines.push(...b.text.split("  \n").map((l) => `> ${l}`), "");
    else if (b.kind === "list") {
      lines.push(`${"    ".repeat(Math.min(b.depth ?? 0, 4))}${b.ordered ? "1." : "-"} ${b.text.replace(/ {2}\n/g, " ")}`);
      const next = blocks.slice(idx + 1).find((x) => x.kind !== "skip");
      if (next?.kind !== "list" || next.ordered !== b.ordered) lines.push("");
    } else lines.push(...(b.text.split("  \n").length > 1 ? [b.text] : [lineSafe(b.text)]), "");
    if (extra) {
      for (const e of extra) {
        const [num, text] = e.split("\uE000");
        lines.push(`[^${num}]: ${text}`, "");
      }
    }
  });
  // Page breaks next to a chapter start, or at the ends of the book, add nothing: drop them.
  let markdown = lines.join("\n").replace(/\uE000PB\uE000/g, "").replace(/\n{3,}/g, "\n\n");
  markdown = markdown
    .split("\n")
    .filter((l, i, a) => !(l === PAGE_BREAK && (/^#{1,} /.test(a[i + 2] ?? "") || i === 0)))
    .join("\n");

  for (const { asset, path } of c.pendingImages) {
    const f = zip.file(path);
    if (f) asset.data = await f.async("uint8array");
  }
  const assets = c.assets.filter((a) => a.data.byteLength > 0);

  const book = importText(markdown, fileName);
  const core = await textOf(zip, "docProps/core.xml");
  let coreTitle: string | undefined;
  let creator: string | undefined;
  if (core) {
    const cd = parse(core);
    const pick = (ns: string, tag: string): string | undefined => cd.getElementsByTagNameNS(ns, tag)[0]?.textContent?.trim() || undefined;
    coreTitle = pick("http://purl.org/dc/elements/1.1/", "title");
    creator = pick("http://purl.org/dc/elements/1.1/", "creator");
  }
  void subtitle;
  const langCode = lang ? /^[a-z]{2,3}/i.exec(lang)?.[0]?.toLowerCase() : undefined;
  const items = (["tables", "textBoxes", "equations", "comments", "deletions", "insertions", "toc", "oldPictures", "unsupportedImages", "imagesNoAlt"] as ReportCode[])
    .map((code) => ({ code, count: c.counts.get(code) ?? 0 }))
    .filter((i) => i.count > 0);
  return {
    ...book,
    title: title ?? coreTitle ?? book.title,
    author: book.author ?? author ?? creator,
    language: book.language ?? langCode,
    assets,
    markdown,
    report: { items, chapters: book.chapters.length, images: assets.length, footnotes: c.noteOrder.size },
  };
}
