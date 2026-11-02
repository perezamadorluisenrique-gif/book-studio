// Print PDF writer. Glyph runs are shaped by the same fontkit code the layout
// measured with, then written as TJ arrays (kerning included) into subset
// CID fonts, so text stays selectable and searchable.

// Default import: the ES build exports only `default`, unlike its typings.
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { parseFaceKey, type FontFile, type FontSet } from "./fonts";
import type { Book } from "./model";
import type { Layout } from "./layout/types";

interface SubsetEmbedder {
  font: { layout(text: string, features?: string[]): { glyphs: FkGlyph[]; positions: { xAdvance: number }[] }; unitsPerEm: number };
  subset: { includeGlyph(g: number | FkGlyph): number };
  glyphs: GlyphRecord[];
  glyphIdMap: Map<number, number>;
  glyphCache: { invalidate(): void };
}

interface FkGlyph {
  id: number;
  codePoints: number[];
  advanceWidth: number;
}

interface GlyphRecord {
  id: number;
  codePoints: number[];
  advanceWidth: number;
}

export interface PdfOptions {
  /** Producer string, e.g. "Book Studio 0.1.0". */
  producer?: string;
  /** Document title, when it should not be the book's title (a cover, a sample). */
  title?: string;
  /** Text printed across every page, faintly: how a sample shows it is not for printing. */
  watermark?: string;
}

const fmt = (n: number) => (Math.abs(n) < 1e-6 ? "0" : String(Math.round(n * 1000) / 1000));

export async function writePdf(book: Book, layout: Layout, fonts: FontSet, opts: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { meta } = book;
  doc.setTitle(opts.title ?? (meta.subtitle ? `${meta.title}: ${meta.subtitle}` : meta.title), { showInWindowTitleBar: true });
  if (meta.authors.length) doc.setAuthor(meta.authors.join(", "));
  if (meta.description) doc.setSubject(meta.description);
  if (meta.subjects.length) doc.setKeywords(meta.subjects);
  doc.setLanguage(meta.language);
  doc.setCreator(opts.producer ?? "Book Studio");
  doc.setProducer(opts.producer ?? "Book Studio");
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const embedded = new Map<FontFile, PDFFont>();
  const fontFor = async (file: FontFile) => {
    let f = embedded.get(file);
    if (!f) {
      const bytes = fonts.bytes.get(file);
      if (!bytes) throw new Error(`Font not loaded: ${file}`);
      f = await doc.embedFont(bytes, { subset: true });
      embedded.set(file, f);
    }
    return f;
  };
  const images = new Map<string, PDFImage>();
  const imageFor = async (path: string) => {
    let img = images.get(path);
    if (!img) {
      const asset = book.images.get(path);
      if (!asset) return null;
      img = asset.mime === "image/png" ? await doc.embedPng(asset.bytes) : await doc.embedJpg(asset.bytes);
      images.set(path, img);
    }
    return img;
  };

  const W = layout.widthPt;
  const H = layout.heightPt;
  const b = layout.bleedPt;
  const pageW = W + b;
  const pageH = H + 2 * b;

  for (const lp of layout.pages) {
    const page = doc.addPage([pageW, pageH]);
    const offX = lp.recto ? 0 : b;
    if (b > 0) page.setBleedBox(0, 0, pageW, pageH);
    page.setTrimBox(offX, b, W, H);
    const fontNames = new Map<FontFile, string>();
    const imageNames = new Map<string, string>();
    const ops: string[] = [];
    let inText = false;
    let curFont = "";
    let curSize = -1;
    let curTc = 0;
    let curColor = "";
    const endText = () => {
      if (inText) ops.push("ET");
      inText = false;
    };
    for (const d of lp.draws) {
      if (d.kind === "text") {
        if (!d.text) continue;
        const { file, features } = parseFaceKey(d.face);
        const font = await fontFor(file);
        let name = fontNames.get(file);
        if (!name) {
          name = page.node.newFontDictionary(file, font.ref).asString();
          fontNames.set(file, name);
        }
        if (!inText) {
          ops.push("BT");
          inText = true;
          curFont = "";
          curSize = -1;
          curTc = 0;
          curColor = "";
        }
        const color = d.color ? `${d.color.map(fmt).join(" ")} rg` : "0 g";
        if (color !== curColor) {
          ops.push(color);
          curColor = color;
        }
        if (curFont !== name || curSize !== d.size) {
          ops.push(`${name} ${fmt(d.size)} Tf`);
          curFont = name;
          curSize = d.size;
        }
        const tc = d.tracking ?? 0;
        if (tc !== curTc) {
          ops.push(`${fmt(tc)} Tc`);
          curTc = tc;
        }
        ops.push(`${matrix(d.angle)} ${fmt(d.x + offX)} ${fmt(H + b - d.y)} Tm`);
        ops.push(`${tjArray(font, d.text, features)} TJ`);
      } else if (d.kind === "image") {
        const img = await imageFor(d.path);
        if (!img) continue;
        endText();
        let name = imageNames.get(d.path);
        if (!name) {
          name = page.node.newXObject("Im", img.ref).asString();
          imageNames.set(d.path, name);
        }
        ops.push("q");
        if (d.clip) ops.push(`${fmt(d.clip.x + offX)} ${fmt(H + b - d.clip.y - d.clip.h)} ${fmt(d.clip.w)} ${fmt(d.clip.h)} re W n`);
        ops.push(`${fmt(d.w)} 0 0 ${fmt(d.h)} ${fmt(d.x + offX)} ${fmt(H + b - d.y - d.h)} cm`, `${name} Do`, "Q");
      } else if (d.kind === "rect") {
        endText();
        const paint = d.fill && d.stroke ? "B" : d.fill ? "f" : "S";
        ops.push("q");
        if (d.fill) ops.push(`${d.fill.map(fmt).join(" ")} rg`);
        if (d.stroke || !d.fill) ops.push(`${(d.stroke ?? [0, 0, 0]).map(fmt).join(" ")} RG`, `${fmt(d.strokeWidth ?? 0.5)} w`);
        if (d.dash?.length) ops.push(`[${d.dash.map(fmt).join(" ")}] 0 d`);
        ops.push(`${fmt(d.x + offX)} ${fmt(H + b - d.y - d.h)} ${fmt(d.w)} ${fmt(d.h)} re`, paint, "Q");
      } else {
        endText();
        ops.push("q", "0 G", `${fmt(d.width)} w`, `${fmt(d.x1 + offX)} ${fmt(H + b - d.y1)} m`, `${fmt(d.x2 + offX)} ${fmt(H + b - d.y2)} l`, "S", "Q");
      }
    }
    if (opts.watermark) {
      endText();
      ops.push(...(await watermarkOps(opts.watermark, page, fontFor, fontNames, W, H, offX, b)));
    }
    endText();
    const stream = doc.context.flateStream(ops.join("\n"));
    page.node.addContentStream(doc.context.register(stream));
  }
  return doc.save({ useObjectStreams: true });
}

const matrix = (angle = 0) => {
  if (!angle) return "1 0 0 1";
  const r = (angle * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c].map(fmt).join(" ");
};

/** Light grey text across the page, inside the text area so it can't be trimmed away. */
async function watermarkOps(text: string, page: PDFPage, fontFor: (file: FontFile) => Promise<PDFFont>, fontNames: Map<FontFile, string>, W: number, H: number, offX: number, b: number): Promise<string[]> {
  const file: FontFile = "Montserrat-SemiBold";
  const font = await fontFor(file);
  let name = fontNames.get(file);
  if (!name) {
    name = page.node.newFontDictionary(file, font.ref).asString();
    fontNames.set(file, name);
  }
  const size = Math.min(W / (text.length * 0.42), 54);
  const width = font.widthOfTextAtSize(text, size);
  const angle = 35;
  const r = (angle * Math.PI) / 180;
  // Centre the string on the page by backing off half its length along the rotated baseline.
  const cx = offX + W / 2;
  const cy = H / 2 + b;
  const x = cx - (Math.cos(r) * width) / 2;
  const y = cy - (Math.sin(r) * width) / 2 - size * 0.3;
  const sid = tjArray(font, text, []);
  return ["BT", "0.78 g", `${name} ${fmt(size)} Tf`, `${matrix(angle)} ${fmt(x)} ${fmt(y)} Tm`, `${sid} TJ`, "ET"];
}

/** Shape `text` with the embedder's own font and encode it as a TJ array with kerning. */
function tjArray(font: PDFFont, text: string, features: string[]): string {
  const emb = (font as unknown as { embedder: SubsetEmbedder }).embedder;
  const run = emb.font.layout(text, features.length ? features : undefined);
  const upm = emb.font.unitsPerEm;
  const parts: string[] = [];
  let hex = "";
  run.glyphs.forEach((g, i) => {
    const sid = emb.subset.includeGlyph(g);
    if (!emb.glyphIdMap.has(g.id)) {
      emb.glyphs[sid - 1] = { id: g.id, codePoints: g.codePoints.length ? g.codePoints : [0xfffd], advanceWidth: g.advanceWidth };
      emb.glyphIdMap.set(g.id, sid);
    }
    hex += sid.toString(16).padStart(4, "0");
    const adjust = ((run.positions[i].xAdvance - g.advanceWidth) * 1000) / upm;
    if (Math.abs(adjust) > 0.01 && i < run.glyphs.length - 1) {
      parts.push(`<${hex}>`, fmt(-adjust));
      hex = "";
    }
  });
  emb.glyphCache.invalidate();
  if (hex) parts.push(`<${hex}>`);
  return `[${parts.join("")}]`;
}
