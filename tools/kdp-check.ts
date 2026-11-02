// Checks a print PDF against the Amazon KDP paperback rules that can be read
// from the file itself. Source: KDP "Set trim size, bleed, and margins"
// (https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) and "Paperback
// submission guidelines". Used by `tools/downloads.ts` before the site ships
// the sample PDFs, and by the tests.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { BLEED, KDP_MAX_PAGES, KDP_MIN_PAGES, kdpMinInside, type Trim } from "../src/engine/trims";

export interface KdpCheck {
  pages: number;
  errors: string[];
}

const PT = 72;
/** Half a point: well under KDP's own tolerance, well over rounding noise. */
const TOLERANCE = 0.5;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

function fmt(pt: number): string {
  return `${(pt / PT).toFixed(3)} in`;
}

/** Every font a page uses, Type0 fonts resolved to their descendant. */
function fontDicts(doc: PDFDocument, resources: PDFDict | undefined): PDFDict[] {
  const out: PDFDict[] = [];
  const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) return out;
  for (const key of fonts.keys()) {
    const font = fonts.lookup(key, PDFDict);
    const subtype = font.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
    if (subtype === "Type0") {
      const kids = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
      for (let i = 0; kids && i < kids.size(); i++) out.push(kids.lookup(i, PDFDict));
    } else out.push(font);
  }
  return out;
}

function isEmbedded(font: PDFDict): boolean {
  const desc = font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  if (!desc) return false;
  return ["FontFile", "FontFile2", "FontFile3"].some((k) => desc.get(PDFName.of(k)) instanceof PDFRef);
}

/**
 * Check `bytes` as the interior of a paperback at `trim`.
 * `insideMarginPt` is the gutter the layout used, from the engine (the PDF does not record it).
 */
export async function checkKdpPdf(bytes: Uint8Array, trim: Trim, opts: { bleed: boolean; insideMarginPt?: number }): Promise<KdpCheck> {
  const errors: string[] = [];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.isEncrypted) errors.push("The PDF is encrypted; KDP rejects protected files.");
  const pages = doc.getPages();
  const n = pages.length;
  if (n < KDP_MIN_PAGES) errors.push(`${n} pages; KDP needs at least ${KDP_MIN_PAGES}.`);
  if (n > KDP_MAX_PAGES) errors.push(`${n} pages; KDP allows at most ${KDP_MAX_PAGES}.`);

  const wantW = (trim.width + (opts.bleed ? BLEED : 0)) * PT;
  const wantH = (trim.height + (opts.bleed ? 2 * BLEED : 0)) * PT;
  const unembedded = new Set<string>();
  pages.forEach((page, i) => {
    const { width, height } = page.getMediaBox();
    if (!near(width, wantW) || !near(height, wantH)) errors.push(`Page ${i + 1} is ${fmt(width)} × ${fmt(height)}; expected ${fmt(wantW)} × ${fmt(wantH)}.`);
    const trimBox = page.getTrimBox();
    if (!near(trimBox.width, trim.width * PT) || !near(trimBox.height, trim.height * PT)) errors.push(`Page ${i + 1} trim box is ${fmt(trimBox.width)} × ${fmt(trimBox.height)}; expected the ${trim.label} trim.`);
    for (const font of fontDicts(doc, page.node.Resources())) {
      if (!isEmbedded(font)) unembedded.add(font.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "unnamed font");
    }
  });
  for (const name of unembedded) errors.push(`Font ${name} is not embedded; KDP requires every font embedded.`);

  if (opts.insideMarginPt !== undefined) {
    const min = kdpMinInside(n) * PT;
    if (opts.insideMarginPt + 0.01 < min) errors.push(`Inside margin ${fmt(opts.insideMarginPt)} is under KDP's ${fmt(min)} for ${n} pages.`);
  }
  return { pages: n, errors };
}
