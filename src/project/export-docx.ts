// Turns a book project back into a Word (.docx) file: the title, the author, every chapter as a
// "Heading 1", paragraphs as "Normal", quotes, lists, tables, footnotes, links, pictures and the
// look-alikes of bold, italic, small caps, strike-through, superscript and subscript. Reading the file
// back with the Word import gives the same Markdown (tests/export-docx.test.ts runs that on 5 books).
//
// Left out: equations (the book has none), a cover page and the book's theme (a Word file has no
// page design to keep); a part is a "Heading 1" like a chapter.
//
// Pure code: it gives back the bytes of the file.

import JSZip from "jszip";
import { parseMarkdown, parseNoteText, type NoteDef, type ParseContext } from "../engine/markdown";
import type { Block, Inline, InlineStyle } from "../engine/model";
import { chapterById, type Project, type ProjectChapter } from "./model";
import { bookOrder } from "./ops";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const EMU_PER_INCH = 914400;
const MAX_WIDTH_EMU = 6 * EMU_PER_INCH;

/** Width and height in pixels of a PNG or JPEG, or null when the bytes are neither. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: v.getUint16(i + 5), w: v.getUint16(i + 7) };
      i += 2 + v.getUint16(i + 2);
    }
  }
  return null;
}

interface Out {
  rels: string[];
  media: { name: string; data: Uint8Array }[];
  notes: string[]; // footnotes.xml entries
  numbering: string[]; // <w:num> entries
  nextRel: number;
  nextNum: number;
  nextDoc: number;
  assets: Map<string, { name: string; mime: string; data: Uint8Array }>;
  noteDefs: Map<string, NoteDef>;
  ctx: ParseContext;
}

function ctxFor(): ParseContext {
  let n = 0;
  return { file: "book.md", lang: "en", smart: false, nextId: () => `b${++n}`, resolve: (target) => target, readNote: async () => "", warnings: [] };
}

// ── Runs ──

function runProps(s: InlineStyle): string {
  let out = "";
  if (s.code) out += '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>';
  if (s.bold) out += "<w:b/>";
  if (s.italic) out += "<w:i/>";
  if (s.strike) out += "<w:strike/>";
  if (s.smallCaps) out += "<w:smallCaps/>";
  if (s.sup) out += '<w:vertAlign w:val="superscript"/>';
  else if (s.sub) out += '<w:vertAlign w:val="subscript"/>';
  return out ? `<w:rPr>${out}</w:rPr>` : "";
}

async function inlineXml(o: Out, inlines: Inline[]): Promise<string> {
  let xml = "";
  for (let k = 0; k < inlines.length; k++) {
    const i = inlines[k];
    if (i.kind === "break") xml += "<w:r><w:br/></w:r>";
    else if (i.kind === "noteRef") xml += await noteXml(o, i.noteId);
    else if (i.style.href) {
      // Runs that share one link go inside one hyperlink.
      const href = i.style.href;
      let group = "";
      let j = k;
      for (; j < inlines.length; j++) {
        const x = inlines[j];
        if (x.kind !== "text" || x.style.href !== href) break;
        group += `<w:r>${runProps({ ...x.style, href: undefined })}<w:t xml:space="preserve">${esc(x.text)}</w:t></w:r>`;
      }
      k = j - 1;
      if (/^(https?:|mailto:)/i.test(href)) {
        const id = `rId${o.nextRel++}`;
        o.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(href)}" TargetMode="External"/>`);
        xml += `<w:hyperlink r:id="${id}">${group}</w:hyperlink>`;
      } else xml += group;
    } else xml += `<w:r>${runProps(i.style)}<w:t xml:space="preserve">${esc(i.text)}</w:t></w:r>`;
  }
  return xml;
}

async function noteXml(o: Out, noteId: string): Promise<string> {
  const def = o.noteDefs.get(noteId);
  if (!def) return "";
  const id = o.notes.length + 1;
  o.notes.push(""); // reserve the number: the text may hold links that take relationship ids
  const blocks = await parseNoteText(def.text, o.ctx, def.line);
  const paras: string[] = [];
  for (const b of blocks) if (b.kind === "paragraph") paras.push(await inlineXml(o, b.inlines));
  const text = paras.join('<w:r><w:t xml:space="preserve"> </w:t></w:r>');
  o.notes[id - 1] = `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${text}</w:p></w:footnote>`;
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

// ── Blocks ──

const para = (style: string | null, runs: string, extra = ""): string => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${runs}</w:p>`;
const plainRun = (text: string): string => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

async function imageXml(o: Out, b: Extract<Block, { kind: "image" }>): Promise<string> {
  const asset = o.assets.get(b.image.path || b.image.target) ?? o.assets.get((b.image.path || b.image.target).replace(/^.*\//, ""));
  if (!asset) return para(null, plainRun(b.image.alt || ""));
  const rel = `rId${o.nextRel++}`;
  const file = `media/${asset.name.replace(/[^\w.-]/g, "_")}`;
  o.media.push({ name: `word/${file}`, data: asset.data });
  o.rels.push(`<Relationship Id="${rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${file}"/>`);
  const size = imageSize(asset.data) ?? { w: 300, h: 300 };
  let cx = Math.round(size.w * 9525);
  let cy = Math.round(size.h * 9525);
  if (cx > MAX_WIDTH_EMU) {
    cy = Math.round((cy * MAX_WIDTH_EMU) / cx);
    cx = MAX_WIDTH_EMU;
  }
  const id = o.nextDoc++;
  const alt = esc(b.image.decorative ? "" : b.image.alt);
  const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(asset.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return para(null, drawing);
}

async function blocksXml(o: Out, blocks: Block[], ctx: { quote?: boolean; list?: { num: number; level: number } } = {}): Promise<string> {
  let xml = "";
  for (const b of blocks) {
    switch (b.kind) {
      case "paragraph": {
        const runs = await inlineXml(o, b.inlines);
        if (ctx.list) xml += para("ListParagraph", runs, `<w:numPr><w:ilvl w:val="${ctx.list.level}"/><w:numId w:val="${ctx.list.num}"/></w:numPr>`);
        else xml += para(ctx.quote ? "Quote" : null, runs, b.align ? `<w:jc w:val="${b.align}"/>` : "");
        break;
      }
      case "heading":
        xml += para(`Heading${Math.min(6, Math.max(1, b.level))}`, await inlineXml(o, b.inlines));
        break;
      case "sceneBreak":
        xml += para(null, plainRun("* * *"));
        break;
      case "pageBreak":
        xml += para(null, '<w:r><w:br w:type="page"/></w:r>');
        break;
      case "blockquote":
        xml += await blocksXml(o, b.blocks, { quote: true });
        break;
      case "list": {
        const level = ctx.list ? ctx.list.level + 1 : 0;
        // Each numbered list has a number of its own, so it starts again at 1 (or at its own start).
        let num = 1;
        if (b.ordered) {
          num = o.nextNum++;
          o.numbering.push(`<w:num w:numId="${num}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${b.start}"/></w:lvlOverride></w:num>`);
        }
        for (const item of b.items) xml += await blocksXml(o, item, { list: { num, level: Math.min(level, 3) } });
        break;
      }
      case "code":
        for (const line of b.text.split("\n")) xml += para(null, `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`);
        break;
      case "image":
        xml += await imageXml(o, b);
        break;
      case "table": {
        const cell = async (inl: Inline[], align: string | null): Promise<string> => `<w:tc><w:tcPr/>${para(null, await inlineXml(o, inl), align && align !== "left" ? `<w:jc w:val="${align}"/>` : "")}</w:tc>`;
        const rows: string[] = [];
        const headerCells = await Promise.all(b.header.map((c, k) => cell(c, b.align[k] ?? null)));
        rows.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${headerCells.join("")}</w:tr>`);
        for (const r of b.rows) rows.push(`<w:tr>${(await Promise.all(r.map((c, k) => cell(c, b.align[k] ?? null)))).join("")}</w:tr>`);
        xml += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.join("")}</w:tbl>`;
        break;
      }
    }
  }
  return xml;
}

// ── The file ──

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function style(id: string, name: string, extra = "", type = "paragraph", based = "Normal"): string {
  return `<w:style w:type="${type}" w:styleId="${id}"${id === "Normal" ? ' w:default="1"' : ""}><w:name w:val="${name}"/>${id === "Normal" ? "" : `<w:basedOn w:val="${based}"/>`}${extra}</w:style>`;
}

function stylesXml(lang: string): string {
  const heading = (n: number, size: number): string => style(`Heading${n}`, `heading ${n}`, `<w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/><w:lang w:val="${esc(lang)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[
    style("Normal", "Normal"),
    style("Title", "Title", '<w:next w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="1200" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr>'),
    style("Subtitle", "Subtitle", '<w:next w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="32"/></w:rPr>'),
    style("Author", "Author", '<w:pPr><w:jc w:val="center"/><w:spacing w:after="1200"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr>'),
    heading(1, 40),
    heading(2, 32),
    heading(3, 28),
    heading(4, 26),
    heading(5, 24),
    heading(6, 24),
    style("Quote", "Quote", '<w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr>'),
    style("ListParagraph", "List Paragraph", '<w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr>'),
    style("FootnoteText", "footnote text", '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>'),
    style("FootnoteReference", "footnote reference", '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>', "character", "DefaultParagraphFont"),
    style("TableGrid", "Table Grid", '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>', "table", "TableNormal"),
  ].join("")}</w:styles>`;
}

const NUMBERING_BASE = `<w:abstractNum w:abstractNumId="0">${[0, 1, 2, 3].map((l) => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:abstractNum w:abstractNumId="1">${[0, 1, 2, 3].map((l) => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;

/** The chapters of a project in book order: front matter, body, back matter. */
function orderedChapters(p: Project): ProjectChapter[] {
  return bookOrder(p).map((id) => chapterById(p, id)).filter((c): c is ProjectChapter => !!c);
}

/** Make the .docx of a book project. */
export async function projectToDocx(p: Project): Promise<Uint8Array> {
  const o: Out = { rels: [], media: [], notes: [], numbering: [], nextRel: 10, nextNum: 2, nextDoc: 1, assets: new Map(), noteDefs: new Map(), ctx: ctxFor() };
  for (const a of p.assets) o.assets.set(a.name, a);
  const lang = p.meta.language || "en";
  let body = "";
  const title = p.meta.title?.trim() || p.name;
  body += para("Title", plainRun(title));
  if (p.meta.subtitle?.trim()) body += para("Subtitle", plainRun(p.meta.subtitle.trim()));
  if (p.meta.author?.trim()) body += para("Author", plainRun(p.meta.author.trim()));

  for (const c of orderedChapters(p)) {
    body += para("Heading1", plainRun(c.title));
    if (c.kind === "part" || !c.body.trim()) continue;
    // Each chapter has its own footnote labels ([^1] in two chapters is two notes).
    const parsed = await parseMarkdown(c.body, o.ctx);
    o.noteDefs = parsed.noteDefs;
    body += await blocksXml(o, parsed.blocks);
  }

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(p.meta.author ?? "")}</dc:creator><dc:language>${esc(lang)}</dc:language></cp:coreProperties>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  zip.file("word/styles.xml", stylesXml(lang));
  zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${NUMBERING_BASE}${o.numbering.join("")}</w:numbering>`);
  zip.file("word/footnotes.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W_NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${o.notes.join("")}</w:footnotes>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>${o.rels.join("")}</Relationships>`,
  );
  for (const m of o.media) zip.file(m.name, m.data);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** The file name for the download: the book's name with .docx. */
export function docxName(p: Project): string {
  const base = (p.meta.title?.trim() || p.name).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "book";
  return `${base}.docx`;
}
