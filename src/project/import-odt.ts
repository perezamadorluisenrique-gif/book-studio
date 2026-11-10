// Turns an OpenDocument text file (.odt, from LibreOffice, Google Docs or Word) into a book.
// Same idea as import-docx.ts: read the text, headings, bold and italic, lists, quotes, tables,
// footnotes, links, page breaks and pictures, write them as Markdown, and hand that to the shared
// part (import-shared.ts) that cuts chapters, counts words and builds the report.
//
// Pure code: the caller gives the XML parser (the browser's DOMParser; tests use xmldom).

import JSZip from "jszip";
import { words } from "./import-text";
import { cleanText, finishImport, MAX_PART_BYTES, render, type Block, type ImportedDocx, type ReportCode, type Seg, type SourcePara } from "./import-shared";
import type { ProjectAsset } from "./model";
import type { ParseXml } from "./import-docx";

export const MAX_ODT_BYTES = 40 * 1024 * 1024;

const NS = {
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
  draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
  svg: "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
  xlink: "http://www.w3.org/1999/xlink",
  dc: "http://purl.org/dc/elements/1.1/",
};

type El = Element;
const kids = (e: El): El[] => Array.from(e.childNodes).filter((n): n is El => n.nodeType === 1);
const a = (e: El | null | undefined, ns: keyof typeof NS, name: string): string | null => (e ? (e.getAttributeNS(NS[ns], name) ?? e.getAttribute(`${ns}:${name}`)) : null);
const is = (e: El, ns: keyof typeof NS, name: string): boolean => e.localName === name && (e.namespaceURI === NS[ns] || e.namespaceURI === null);
const decodeName = (n: string): string => n.replace(/_20_/g, " ");

interface Look {
  parent?: string;
  display?: string;
  auto: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  smallCaps: boolean;
  pos?: "u" | "d";
  align?: "center" | "right";
  breakBefore: boolean;
  breakAfter: boolean;
  listStyle?: string;
}

interface Ctx {
  styles: Map<string, Look>;
  lists: Map<string, Map<number, boolean>>; // list style → level → ordered?
  zip: JSZip;
  assets: ProjectAsset[];
  imageNames: Map<string, string>;
  pendingImages: { asset: ProjectAsset; path: string }[];
  counts: Map<ReportCode, number>;
  noteOrder: number;
  pendingNotes: string[];
  inNote: boolean;
  titleStyles: Set<string>;
  paras: { style: string; text: string; heading: boolean }[];
}

const bump = (c: Ctx, code: ReportCode, n = 1): void => void c.counts.set(code, (c.counts.get(code) ?? 0) + n);

function readStyles(doc: Document | null, auto: boolean, into: Map<string, Look>, lists: Map<string, Map<number, boolean>>): void {
  if (!doc) return;
  for (const s of Array.from(doc.getElementsByTagNameNS(NS.style, "style"))) {
    const name = a(s, "style", "name");
    if (!name) continue;
    const look: Look = { auto, parent: a(s, "style", "parent-style-name") ?? undefined, display: a(s, "style", "display-name") ?? undefined, bold: false, italic: false, strike: false, smallCaps: false, breakBefore: false, breakAfter: false, listStyle: a(s, "style", "list-style-name") ?? undefined };
    for (const k of kids(s)) {
      if (is(k, "style", "text-properties")) {
        look.bold = ["bold", "600", "700", "800", "900"].includes(a(k, "fo", "font-weight") ?? "");
        look.italic = ["italic", "oblique"].includes(a(k, "fo", "font-style") ?? "");
        look.strike = (a(k, "style", "text-line-through-style") ?? "none") !== "none";
        look.smallCaps = a(k, "fo", "font-variant") === "small-caps";
        const pos = a(k, "style", "text-position") ?? "";
        if (/^super/.test(pos) || /^\d+%/.test(pos)) look.pos = "u";
        else if (/^sub/.test(pos) || /^-\d+%/.test(pos)) look.pos = "d";
      } else if (is(k, "style", "paragraph-properties")) {
        const al = a(k, "fo", "text-align");
        look.align = al === "center" ? "center" : al === "end" || al === "right" ? "right" : undefined;
        look.breakBefore = a(k, "fo", "break-before") === "page";
        look.breakAfter = a(k, "fo", "break-after") === "page";
      }
    }
    into.set(name, look);
  }
  for (const ls of Array.from(doc.getElementsByTagNameNS(NS.text, "list-style"))) {
    const name = a(ls, "style", "name");
    if (!name) continue;
    const levels = new Map<number, boolean>();
    for (const l of kids(ls)) {
      const level = Number(a(l, "text", "level")) || 1;
      levels.set(level, is(l, "text", "list-level-style-number"));
    }
    lists.set(name, levels);
  }
}

/** A style looked up through its parents: the first answer found going up wins. */
function lookup<T>(c: Ctx, name: string | null | undefined, pick: (l: Look) => T | undefined): T | undefined {
  for (let n = name ?? undefined, i = 0; n && i < 12; i++) {
    const l = c.styles.get(n);
    if (!l) return undefined;
    const v = pick(l);
    if (v !== undefined && v !== false) return v;
    n = l.parent;
  }
  return undefined;
}

/** The name of the first named (not automatic) style going up from `name`, in plain words. */
function baseName(c: Ctx, name: string | null | undefined): string {
  let n = name ?? "";
  for (let i = 0; i < 12; i++) {
    const l = c.styles.get(n);
    if (!l || !l.auto || !l.parent) return n;
    n = l.parent;
  }
  return n;
}

const readable = (c: Ctx, id: string): string => (c.styles.get(id)?.display ?? decodeName(id)).toLowerCase();

// ── Text of a paragraph ──

function imageFor(c: Ctx, frame: El): string {
  const img = kids(frame).find((k) => is(k, "draw", "image"));
  const href = a(img, "xlink", "href");
  if (!href) return "";
  const alt = (kids(frame).find((k) => is(k, "svg", "desc"))?.textContent ?? kids(frame).find((k) => is(k, "svg", "title"))?.textContent ?? "").replace(/[\r\n[\]]+/g, " ").trim();
  if (!alt) bump(c, "imagesNoAlt");
  const cached = c.imageNames.get(href);
  if (cached !== undefined) return cached ? `![${alt}](<${cached}>)` : "";
  const ext = /\.(png|jpe?g)$/i.exec(href)?.[1]?.toLowerCase();
  if (!ext) {
    bump(c, "unsupportedImages");
    c.imageNames.set(href, "");
    return "";
  }
  const name = `odt-image-${c.assets.length + 1}.${ext === "jpeg" ? "jpg" : ext}`;
  c.imageNames.set(href, name);
  const asset: ProjectAsset = { name, mime: ext === "png" ? "image/png" : "image/jpeg", data: new Uint8Array(0) };
  c.assets.push(asset);
  c.pendingImages.push({ asset, path: href });
  return `![${alt}](<${name}>)`;
}

interface Fmt {
  b: boolean;
  i: boolean;
  x: string;
}

const extras = (l: Look | undefined, base: string): string => base + (l?.strike && !base.includes("s") ? "s" : "") + (l?.smallCaps && !base.includes("c") ? "c" : "") + (l?.pos === "u" && !base.includes("u") ? "u" : "") + (l?.pos === "d" && !base.includes("d") ? "d" : "");

function inlineSegs(c: Ctx, p: El, out: Seg[], fmt: Fmt): void {
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType === 3) {
      // ODF collapses runs of spaces and newlines in text nodes; text:s adds the real ones.
      const t = (node.nodeValue ?? "").replace(/[ \t\r\n]+/g, " ");
      if (t) out.push({ text: t, b: fmt.b, i: fmt.i, x: fmt.x });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const e = node as El;
    const n = e.localName;
    if (n === "s") out.push({ text: " ".repeat(Math.min(50, Number(a(e, "text", "c")) || 1)), b: fmt.b, i: fmt.i, x: fmt.x });
    else if (n === "tab") out.push({ text: " ", b: fmt.b, i: fmt.i, x: fmt.x });
    else if (n === "line-break") out.push({ text: "\uE000BR", b: false, i: false });
    else if (n === "span") {
      const name = a(e, "text", "style-name");
      const bold = lookup(c, name, (l) => l.bold || undefined) ?? false;
      const italic = lookup(c, name, (l) => l.italic || undefined) ?? false;
      const l = name ? c.styles.get(name) : undefined;
      inlineSegs(c, e, out, { b: fmt.b || bold, i: fmt.i || italic, x: extras(l, fmt.x) });
    } else if (n === "a") {
      const url = a(e, "xlink", "href");
      const inner: Seg[] = [];
      inlineSegs(c, e, inner, fmt);
      if (url && /^(https?:|mailto:)/i.test(url)) out.push({ text: "\uE000RAW[\uE000", b: false, i: false }, ...inner, { text: `\uE000RAW](<${url}>)\uE000`, b: false, i: false });
      else out.push(...inner);
    } else if (n === "note") {
      if (c.inNote) continue;
      const body = kids(e).find((k) => is(k, "text", "note-body"));
      const num = ++c.noteOrder;
      out.push({ text: `\uE000RAW[^${num}]\uE000`, b: false, i: false });
      if (body) {
        c.inNote = true;
        const parts = kids(body)
          .filter((k) => is(k, "text", "p"))
          .map((k) => render(c, paragraphSegs(c, k)).replace(/\n+/g, " ").trim())
          .filter(Boolean);
        c.inNote = false;
        c.pendingNotes.push(`${num}\uE000${parts.join(" ")}`);
      }
    } else if (n === "frame") {
      if (kids(e).some((k) => is(k, "draw", "image"))) out.push({ text: `\uE000RAW${imageFor(c, e)}\uE000`, b: false, i: false });
    } else if (n === "soft-page-break" || n === "tracked-changes" || n === "annotation" || n === "annotation-end" || n === "bookmark" || n === "bookmark-start" || n === "bookmark-end") {
      if (n === "annotation") bump(c, "comments");
    } else if (n === "change-start" || n === "change-end" || n === "change") {
      // Tracked changes: the deleted text sits in text:tracked-changes, outside the body flow.
    } else inlineSegs(c, e, out, fmt);
  }
}

function paragraphSegs(c: Ctx, p: El): Seg[] {
  const segs: Seg[] = [];
  const name = a(p, "text", "style-name");
  inlineSegs(c, p, segs, { b: !!lookup(c, name, (l) => l.bold || undefined), i: !!lookup(c, name, (l) => l.italic || undefined), x: "" });
  return segs;
}

// ── Blocks ──

function paragraphBlocks(c: Ctx, p: El, depthIn?: { depth: number; ordered: boolean }): Block[] {
  const styleName = a(p, "text", "style-name");
  const base = baseName(c, styleName);
  const readableStyle = readable(c, base);
  const blocks: Block[] = [];
  if (lookup(c, styleName, (l) => l.breakBefore || undefined)) blocks.push({ kind: "pageBreak", text: "" });
  const segs = paragraphSegs(c, p);
  const hasPageBreak = segs.some((s) => s.text === "\uE000PB");
  void hasPageBreak;
  if (/^(table of contents|contents|[ií]ndice|contenido)/i.test(readableStyle) || /^(contents|toc) ?\d/i.test(readableStyle)) {
    bump(c, "toc");
    return [{ kind: "skip", text: "" }];
  }
  if (readableStyle === "horizontal line") return [{ kind: "paragraph", text: "* * *" }];
  const text = cleanText(render(c, segs).trim());
  if (text) {
    const outline = is(p, "text", "h") ? Number(a(p, "text", "outline-level")) || 1 : 0;
    const level = c.titleStyles.has(base) ? 1 : outline || (/^heading ?(\d)$/.exec(readableStyle)?.[1] ? Number(/^heading ?(\d)$/.exec(readableStyle)?.[1]) : 0);
    c.paras.push({ style: base, text: text.replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\*+/g, ""), heading: level > 0 });
    if (level) blocks.push({ kind: "heading", level, text: text.replace(/\*+/g, "").replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\s+/g, " ").trim() });
    else if (readableStyle === "title") blocks.push({ kind: "paragraph", text, title: true });
    else if (readableStyle === "subtitle") blocks.push({ kind: "paragraph", text, subtitle: true });
    else if (readableStyle === "author") blocks.push({ kind: "paragraph", text, author: true });
    else if (readableStyle === "date") blocks.push({ kind: "skip", text: "" });
    else if (depthIn) blocks.push({ kind: "list", text, ordered: depthIn.ordered, depth: depthIn.depth });
    else if (/quot|citation|block text|texto en bloque|cita/.test(readableStyle)) blocks.push({ kind: "quote", text });
    else {
      const align = lookup(c, styleName, (l) => l.align);
      blocks.push({ kind: "paragraph", text, ...(align ? { align } : {}) });
    }
  }
  if (lookup(c, styleName, (l) => l.breakAfter || undefined)) blocks.push({ kind: "pageBreak", text: "" });
  return blocks;
}

function tableRows(c: Ctx, tbl: El): string[] {
  const grid: string[][] = [];
  const carry: { text: string; left: number }[] = []; // cells that span rows, by column
  let merged = 0;
  const rowEls: El[] = [];
  const collect = (e: El): void => {
    for (const k of kids(e)) {
      if (is(k, "table", "table-row")) rowEls.push(k);
      else if (is(k, "table", "table-header-rows") || is(k, "table", "table-row-group") || is(k, "table", "table-rows")) collect(k);
    }
  };
  collect(tbl);
  for (const tr of rowEls) {
    const row: string[] = [];
    let spanLeft = 0;
    let spanText = "";
    for (const tc of kids(tr)) {
      const covered = is(tc, "table", "covered-table-cell");
      if (!covered && !is(tc, "table", "table-cell")) continue;
      const repeat = Math.min(Number(a(tc, "table", "number-columns-repeated")) || 1, 40);
      for (let r = 0; r < repeat; r++) {
        const col = row.length;
        let text: string;
        if (covered) {
          if (carry[col]?.left) {
            text = carry[col].text;
            carry[col].left--;
          } else {
            text = spanText;
          }
          if (spanLeft > 0) spanLeft--;
        } else {
          text = kids(tc)
            .filter((k) => is(k, "text", "p") || is(k, "text", "h"))
            .map((p) => render(c, paragraphSegs(c, p)).replace(/ {2}\n/g, " ").trim())
            .filter(Boolean)
            .join("<br>")
            .replace(/\|/g, "\\|");
          const cs = Number(a(tc, "table", "number-columns-spanned")) || 1;
          const rs = Number(a(tc, "table", "number-rows-spanned")) || 1;
          if (cs > 1 || rs > 1) merged++;
          spanLeft = cs - 1;
          spanText = text;
          if (rs > 1) carry[col] = { text, left: rs - 1 };
        }
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

// ── Words in the file, for the word-count guarantee ──

function ownText(p: El): string {
  let out = "";
  const walkText = (e: El): void => {
    for (const node of Array.from(e.childNodes)) {
      if (node.nodeType === 3) out += node.nodeValue ?? "";
      else if (node.nodeType === 1) {
        const k = node as El;
        const n = k.localName;
        if (n === "note" || n === "frame" || n === "annotation" || n === "tracked-changes") continue;
        if (n === "s") out += " ";
        else if (n === "tab" || n === "line-break") out += " ";
        else walkText(k);
      }
    }
  };
  walkText(p);
  return out;
}

function sourceParagraphs(c: Ctx, body: El): SourcePara[] {
  const out: SourcePara[] = [];
  let place = "";
  let note = 0;
  const walkNode = (e: El, inNote: number): void => {
    for (const k of kids(e)) {
      const n = k.localName;
      if (n === "tracked-changes" || n === "table-of-content" || n === "illustration-index" || n === "alphabetical-index" || n === "bibliography") continue;
      if (n === "p" || n === "h") {
        const text = ownText(k).replace(/\s+/g, " ").trim();
        if (n === "h" && text) place = text;
        const style = readable(c, baseName(c, a(k, "text", "style-name")));
        const toc = /^(table of contents|contents|[ií]ndice|contenido)/i.test(style) || /^(contents|toc) ?\d/i.test(style);
        if (!toc && words(text).length) out.push({ text, place: inNote ? `[^${inNote}]` : place });
      }
      if (n === "note") {
        walkNode(k, ++note);
        continue;
      }
      walkNode(k, inNote);
    }
  };
  walkNode(body, 0);
  return out;
}

function titleStyleCandidates(c: Ctx): { id: string; name: string; count: number; examples: string[] }[] {
  const known = /^(standard|default|body text|text body|first line indent|text|normal|title|subtitle|author|date|heading|quotations?|quote|list|header|footer|footnote|endnote|caption|table|index|contents|preformatted|hanging|marginalia|sender|signature|salutation|complimentary|addressee|horizontal line|frame|illustration|drawing|numbering|bullet|texto|cuerpo|est[aá]ndar|t[ií]tulo|subt[ií]tulo|autor|fecha|encabezado|pie|cita|[ií]ndice)/i;
  const by = new Map<string, { n: number; followed: number; max: number; examples: string[] }>();
  c.paras.forEach((p, k) => {
    if (!p.style || p.heading) return;
    if (known.test(readable(c, p.style))) return;
    const e = by.get(p.style) ?? { n: 0, followed: 0, max: 0, examples: [] };
    e.n++;
    e.max = Math.max(e.max, p.text.length);
    if (c.paras[k + 1] && c.paras[k + 1].style !== p.style) e.followed++;
    if (e.examples.length < 2) e.examples.push(p.text.slice(0, 40));
    by.set(p.style, e);
  });
  const out: ReturnType<typeof titleStyleCandidates> = [];
  for (const [id, e] of by) if (e.n >= 2 && e.max <= 80 && e.followed / e.n >= 0.8) out.push({ id, name: readable(c, id), count: e.n, examples: e.examples });
  return out;
}

/** Read the .odt and give back chapters, pictures and a report (the same shape as the Word import). */
export async function importOdt(bytes: Uint8Array, parse: ParseXml, fileName = "", options: { titleStyles?: string[] } = {}): Promise<ImportedDocx> {
  if (bytes.byteLength > MAX_ODT_BYTES) throw new Error("docx.tooBig");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("odt.notOdt");
  }
  const text = async (path: string): Promise<string | null> => {
    const f = zip.file(path);
    if (!f) return null;
    const t = await f.async("string");
    if (t.length > MAX_PART_BYTES) throw new Error("docx.tooBig");
    return t;
  };
  const contentXml = await text("content.xml");
  if (!contentXml) throw new Error("odt.notOdt");
  const content = parse(contentXml);
  const body = content.getElementsByTagNameNS(NS.office, "text")[0];
  if (!body) throw new Error("odt.notOdt");
  const styles = new Map<string, Look>();
  const lists = new Map<string, Map<number, boolean>>();
  const stylesXml = await text("styles.xml");
  readStyles(stylesXml ? parse(stylesXml) : null, false, styles, lists);
  readStyles(content, true, styles, lists);
  const c: Ctx = { styles, lists, zip, assets: [], imageNames: new Map(), pendingImages: [], counts: new Map(), noteOrder: 0, pendingNotes: [], inNote: false, titleStyles: new Set(options.titleStyles ?? []), paras: [] };

  const blocks: Block[] = [];
  const notesAfter = new Map<number, string[]>();
  let emptyRun = 0;
  const addParagraph = (p: El, list?: { depth: number; ordered: boolean }): void => {
    c.pendingNotes = [];
    const found = paragraphBlocks(c, p, list);
    if (!found.length) emptyRun++;
    else {
      // Two or more empty paragraphs in a row between text are a scene break.
      const prev = blocks[blocks.length - 1];
      if (emptyRun >= 2 && prev && ["paragraph", "quote", "list", "table"].includes(prev.kind) && ["paragraph", "quote", "list"].includes(found[0].kind) && !found[0].title && !found[0].author) blocks.push({ kind: "paragraph", text: "* * *" });
      emptyRun = 0;
    }
    blocks.push(...found);
    if (c.pendingNotes.length && found.length) notesAfter.set(blocks.length - 1, [...c.pendingNotes]);
    // Text boxes: their paragraphs come after the paragraph that holds them, as quotes.
    for (const fr of Array.from(p.getElementsByTagNameNS(NS.draw, "text-box"))) {
      bump(c, "textBoxes");
      for (const tp of Array.from(fr.getElementsByTagNameNS(NS.text, "p"))) {
        const t = render(c, paragraphSegs(c, tp)).trim();
        if (t) blocks.push({ kind: "quote", text: t });
      }
    }
  };
  const walkList = (list: El, depth: number, inheritedStyle: string | null): void => {
    const styleName = a(list, "text", "style-name") ?? inheritedStyle;
    const ordered = styleName ? (lists.get(styleName)?.get(depth + 1) ?? false) : false;
    for (const item of kids(list)) {
      if (!is(item, "text", "list-item") && !is(item, "text", "list-header")) continue;
      for (const k of kids(item)) {
        if (is(k, "text", "p") || is(k, "text", "h")) addParagraph(k, { depth, ordered });
        else if (is(k, "text", "list")) walkList(k, depth + 1, styleName);
      }
    }
  };
  const walk = (parent: El): void => {
    for (const node of kids(parent)) {
      const n = node.localName;
      if (n === "p" || n === "h") addParagraph(node);
      else if (n === "list") walkList(node, 0, null);
      else if (n === "table") {
        emptyRun = 0;
        const rows = tableRows(c, node);
        if (rows.length) {
          bump(c, "tables");
          blocks.push({ kind: "table", text: "", rows });
        }
      } else if (n === "table-of-content") bump(c, "toc");
      else if (n === "section") walk(node);
    }
  };
  walk(body);

  const levels = blocks.filter((b) => b.kind === "heading").map((b) => b.level ?? 1);
  const titleStyles = levels.length || c.titleStyles.size ? [] : titleStyleCandidates(c);
  for (const { asset, path } of c.pendingImages) {
    const f = zip.file(path);
    if (f) asset.data = await f.async("uint8array");
  }
  const metaXml = await text("meta.xml");
  let coreTitle: string | undefined;
  let creator: string | undefined;
  let lang: string | undefined;
  if (metaXml) {
    const md = parse(metaXml);
    const pick = (tag: string): string | undefined => md.getElementsByTagNameNS(NS.dc, tag)[0]?.textContent?.trim() || undefined;
    coreTitle = pick("title");
    creator = pick("creator");
    lang = pick("language");
  }
  return finishImport({ blocks, notesAfter, fileName, assets: c.assets, counts: c.counts, footnotes: c.noteOrder, source: sourceParagraphs(c, body), titleStyles, meta: { title: coreTitle, creator, lang } });
}
