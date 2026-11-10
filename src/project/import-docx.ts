// Turns a Word (.docx) manuscript into a book (C2 of the app plan).
// A .docx is a zip of XML files. We read the text, the headings, bold and italic, lists, quotes,
// footnotes, links, page breaks and pictures, write them as Markdown, and hand that to the same
// chapter splitter that imports .md and .txt files. Whatever cannot be kept (tables, text boxes,
// comments, equations…) is left out and listed in the report, so nothing disappears silently.
//
// Pure code: the caller gives the XML parser (the browser's DOMParser; tests use xmldom).

import JSZip from "jszip";
import { words } from "./import-text";
import { cleanText, finishImport, render,  MAX_PART_BYTES, type Block, type ImportedDocx, type Seg, type ReportCode, type SourcePara } from "./import-shared";
import type { ProjectAsset } from "./model";

export type { DocxReport, ImportedDocx, ReportCode, WordCheck } from "./import-shared";

export type ParseXml = (xml: string) => Document;

export const MAX_DOCX_BYTES = 40 * 1024 * 1024;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

type El = Element;

const kids = (e: El): El[] => Array.from(e.childNodes).filter((n): n is El => n.nodeType === 1);
const child = (e: El | null | undefined, name: string): El | null => (e ? (kids(e).find((k) => k.localName === name && k.namespaceURI === W) ?? null) : null);
const attr = (e: El | null | undefined, name: string): string | null => (e ? (e.getAttributeNS(W, name) ?? e.getAttribute(`w:${name}`)) : null);
/** A toggle such as <w:b/> is on unless it says val="0" or "false". */
const on = (e: El | null): boolean => !!e && !["0", "false", "off"].includes((attr(e, "val") ?? "").toLowerCase());

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
  /** Style ids the person said are chapter titles. */
  titleStyles: Set<string>;
  /** Every body paragraph with its style, to look for a style of chapter titles. */
  paras: { style: string; text: string; heading: boolean }[];
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
      const va = attr(child(rpr, "vertAlign"), "val");
      const x = (on(child(rpr, "strike")) || on(child(rpr, "dstrike")) ? "s" : "") + (on(child(rpr, "smallCaps")) ? "c" : "") + (va === "superscript" ? "u" : va === "subscript" ? "d" : "");
      for (const part of kids(node)) {
        const k = part.localName;
        if (k === "t") out.push({ text: part.textContent ?? "", b, i, x });
        else if (k === "tab") out.push({ text: " ", b, i, x });
        else if (k === "noBreakHyphen") out.push({ text: "-", b, i, x });
        else if (k === "sym") out.push({ text: "", b, i });
        else if (k === "br") {
          const type = attr(part, "type");
          if (type === "page") out.push({ text: `\uE000PB`, b: false, i: false });
          else if (!type || type === "textWrapping") out.push({ text: "\uE000BR", b: false, i: false });
        } else if (k === "drawing") out.push({ text: `\uE000RAW${imageFor(c, part)}\uE000`, b: false, i: false });
        else if (k === "pict" || k === "object") {
          // A horizontal rule drawn as an old-format shape is a scene break.
          const rule = Array.from(part.getElementsByTagName("*")).some((e) => e.localName === "rect" && (e.getAttribute("o:hr") === "t" || e.getAttributeNS("urn:schemas-microsoft-com:office:office", "hr") === "t"));
          if (rule) out.push({ text: "\uE000RAW* * *\uE000", b: false, i: false });
          else if (!part.getElementsByTagNameNS(W, "txbxContent").length) bump(c, "oldPictures");
        }
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
    const text = cleanText(render(c, piece).trim());
    if (!text) return;
    const heading = /^heading\s*(\d)$/i.exec(style) ?? /^t[ií]tulo\s*(\d)$/i.exec(style);
    const outline = attr(child(ppr, "outlineLvl"), "val");
    const level = c.titleStyles.has(styleId) ? 1 : heading ? Number(heading[1]) : outline !== null && /^\d$/.test(outline) && Number(outline) < 6 ? Number(outline) + 1 : 0;
    if (idx === 0) c.paras.push({ style: styleId, text: text.replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\*+/g, ""), heading: level > 0 });
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
    const jc = attr(child(ppr, "jc"), "val");
    const align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : undefined;
    blocks.push({ kind: "paragraph", text, ...(align ? { align } : {}) });
  });
  void breaks;
  return blocks;
}

const KNOWN_STYLE = /^(?:(?:normal|default|body text|first paragraph|compact|text body|texto|cuerpo|sin espaciado|no spacing|standard|predeterminado|estándar|title|subtitle|author|date|abstract|t[ií]tulo|subt[ií]tulo|autor|fecha)(?: \(web\)| independiente| de cuerpo| principal)?|(?:heading|block|quote|cita|list|lista|footnote|nota|endnote|header|footer|encabezado|pie|caption|leyenda|toc|index|[ií]ndice|table|tabla|hyperlink|macro|comment|balloon|revision|plain text|texto sin)\b.*)$/i;

/** Own styles that look like chapter titles: short paragraphs, each followed by a paragraph of another style. */
function titleStyleCandidates(c: Ctx): NonNullable<ImportedDocx["report"]["titleStyles"]> {
  const by = new Map<string, { n: number; followed: number; len: number; max: number; examples: string[] }>();
  c.paras.forEach((p, k) => {
    if (!p.style || p.heading) return;
    const name = c.styles.get(p.style) ?? p.style.toLowerCase();
    if (KNOWN_STYLE.test(name) || KNOWN_STYLE.test(p.style)) return;
    const e = by.get(p.style) ?? { n: 0, followed: 0, len: 0, max: 0, examples: [] };
    e.n++;
    e.len += p.text.length;
    e.max = Math.max(e.max, p.text.length);
    if (c.paras[k + 1] && c.paras[k + 1].style !== p.style) e.followed++;
    if (e.examples.length < 2) e.examples.push(p.text.slice(0, 40));
    by.set(p.style, e);
  });
  const out: ReturnType<typeof titleStyleCandidates> = [];
  for (const [id, e] of by) if (e.n >= 2 && e.max <= 80 && e.followed / e.n >= 0.8) out.push({ id, name: c.styles.get(id) ?? id, count: e.n, examples: e.examples });
  return out;
}

// ── Word-count guarantee ──
// Counts the words in the XML on its own, then looks for every paragraph in the finished book.

const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** The text of one paragraph as Word shows it: no deleted text, no nested paragraphs (text boxes, cells). */
function ownText(p: El): string {
  let out = "";
  const walkText = (e: El): void => {
    for (const k of kids(e)) {
      const n = k.localName;
      if (n === "p" || n === "del" || n === "moveFrom" || n === "pPr" || n === "rPr") continue;
      if (n === "t") out += k.textContent ?? "";
      else if (n === "tab" || n === "br" || n === "cr") out += " ";
      else if (n === "noBreakHyphen") out += "-";
      else if (n === "Fallback" && k.namespaceURI === MC) continue;
      else walkText(k);
    }
  };
  walkText(p);
  return out;
}

/** True when a paragraph sits in deleted text or in the old-format copy of a text box. */
function ignoredParagraph(p: El, root: El): boolean {
  for (let a = p.parentNode as El | null; a && a !== root; a = a.parentNode as El | null) {
    if (a.localName === "del" || a.localName === "moveFrom" || (a.localName === "Fallback" && a.namespaceURI === MC)) return true;
  }
  return false;
}

const isTocStyle = (style: string): boolean => /^(toc|table of contents|contents|índice|tabla de contenido)/i.test(style) || /^toc\s*\d/i.test(style);

function headingText(c: Ctx, p: El): string | null {
  const ppr = child(p, "pPr");
  const styleId = attr(child(ppr, "pStyle"), "val") ?? "";
  const style = c.styles.get(styleId) ?? styleId.toLowerCase();
  const outline = attr(child(ppr, "outlineLvl"), "val");
  if (/^heading\s*\d$/i.test(style) || /^t[ií]tulo\s*\d$/i.test(style) || (outline !== null && /^\d$/.test(outline) && Number(outline) < 6)) return ownText(p).replace(/\s+/g, " ").trim();
  return null;
}

/** Every paragraph of the body, the tables, the text boxes and the notes that the book uses. */
function sourceParagraphs(c: Ctx, body: El): SourcePara[] {
  const out: SourcePara[] = [];
  let place = "";
  for (const p of Array.from(body.getElementsByTagNameNS(W, "p"))) {
    if (ignoredParagraph(p, body)) continue;
    const styleId = attr(child(child(p, "pPr"), "pStyle"), "val") ?? "";
    if (isTocStyle(c.styles.get(styleId) ?? styleId.toLowerCase())) continue;
    const head = headingText(c, p);
    if (head) place = head;
    const text = ownText(p).replace(/\s+/g, " ").trim();
    if (words(text).length) out.push({ text, place });
  }
  for (const [key, num] of c.noteOrder) {
    const note = c.footnotes.get(key);
    if (!note) continue;
    for (const p of kids(note).filter((k) => k.localName === "p")) {
      const text = ownText(p).replace(/\s+/g, " ").trim();
      if (words(text).length) out.push({ text, place: `[^${num}]` });
    }
  }
  return out;
}

function insideTextBox(tb: El, root: El): boolean {
  for (let a = tb.parentNode as El | null; a && a !== root; a = a.parentNode as El | null) if (a.localName === "txbxContent") return true;
  return false;
}

/** A Word table as Markdown rows. A merged cell is repeated in every cell it covers. */
function tableRows(c: Ctx, tbl: El): string[] {
  const grid: string[][] = [];
  const above: string[] = [];
  let merged = 0;
  for (const tr of kids(tbl).filter((k) => k.localName === "tr")) {
    const row: string[] = [];
    for (const tc of kids(tr).filter((k) => k.localName === "tc")) {
      const tcPr = child(tc, "tcPr");
      const span = Math.max(1, Number(attr(child(tcPr, "gridSpan"), "val")) || 1);
      const vm = child(tcPr, "vMerge");
      const continued = !!vm && (attr(vm, "val") ?? "continue") !== "restart";
      const text = continued
        ? (above[row.length] ?? "")
        : kids(tc)
            .filter((k) => k.localName === "p")
            .map((p) => render(c, paragraphSegs(c, p)).replace(/ {2}\n/g, " ").trim())
            .filter(Boolean)
            .join("<br>")
            .replace(/\|/g, "\\|");
      if (span > 1 || vm) merged++;
      for (let k = 0; k < span; k++) {
        above[row.length] = text;
        row.push(text);
      }
    }
    if (row.length) grid.push(row);
  }
  if (merged) bump(c, "mergedCells", merged);
  if (!grid.length) return [];
  const cols = Math.max(...grid.map((r) => r.length));
  const line = (r: string[]): string => `| ${Array.from({ length: cols }, (_, k) => r[k] ?? "").join(" | ")} |`;
  return [line(grid[0]), `|${" --- |".repeat(cols)}`, ...grid.slice(1).map(line)];
}

/** Read the .docx and give back chapters, pictures and a report. */
export async function importDocx(bytes: Uint8Array, parse: ParseXml, fileName = "", options: { titleStyles?: string[] } = {}): Promise<ImportedDocx> {
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
    titleStyles: new Set(options.titleStyles ?? []),
    paras: [],
  };
  if (zip.file("word/comments.xml")) bump(c, "comments", 0);

  // Walk the body in order.
  const blocks: Block[] = [];
  const notesAfter: Map<number, string[]> = new Map();
  let emptyRun = 0;
  const walk = (parent: El): void => {
    for (const node of kids(parent)) {
      const n = node.localName;
      if (n === "p") {
        c.pendingNotes = [];
        const found = paragraphBlock(c, node);
        if (!found.length) emptyRun++;
        else {
          // Two or more empty paragraphs in a row between text are a scene break.
          const prev = blocks[blocks.length - 1];
          if (emptyRun >= 2 && prev && ["paragraph", "quote", "list", "table"].includes(prev.kind) && ["paragraph", "quote", "list"].includes(found[0].kind) && !found[0].title && !found[0].author) blocks.push({ kind: "paragraph", text: "* * *" });
          emptyRun = 0;
        }
        blocks.push(...found);
        if (c.pendingNotes.length && found.length) notesAfter.set(blocks.length - 1, [...c.pendingNotes]);
        for (const tb of Array.from(node.getElementsByTagNameNS(W, "txbxContent"))) {
          if (ignoredParagraph(tb, node) || insideTextBox(tb, node)) continue;
          bump(c, "textBoxes");
          for (const tp of kids(tb).filter((k) => k.localName === "p")) {
            const text = render(c, paragraphSegs(c, tp)).trim();
            if (text) blocks.push({ kind: "quote", text });
          }
        }
      } else if (n === "tbl") {
        emptyRun = 0;
        const rows = tableRows(c, node);
        if (rows.length) {
          bump(c, "tables");
          blocks.push({ kind: "table", text: "", rows });
        }
      }
      else if (n === "sdt") walk(child(node, "sdtContent") ?? node);
      else if (n === "customXml" || n === "ins") walk(node);
    }
  };
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("docx.notDocx");
  walk(body);

  const levels = blocks.filter((b) => b.kind === "heading").map((b) => b.level ?? 1);
  const titleStyles = levels.length || c.titleStyles.size ? [] : titleStyleCandidates(c);

  for (const { asset, path } of c.pendingImages) {
    const f = zip.file(path);
    if (f) asset.data = await f.async("uint8array");
  }

  const core = await textOf(zip, "docProps/core.xml");
  let coreTitle: string | undefined;
  let creator: string | undefined;
  if (core) {
    const cd = parse(core);
    const pick = (ns: string, tag: string): string | undefined => cd.getElementsByTagNameNS(ns, tag)[0]?.textContent?.trim() || undefined;
    coreTitle = pick("http://purl.org/dc/elements/1.1/", "title");
    creator = pick("http://purl.org/dc/elements/1.1/", "creator");
  }
  return finishImport({ blocks, notesAfter, fileName, assets: c.assets, counts: c.counts, footnotes: c.noteOrder.size, source: sourceParagraphs(c, body), titleStyles, meta: { title: coreTitle, creator, lang } });
}
