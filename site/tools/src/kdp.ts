// The KDP numbers behind the free tools, as pure functions. Every figure comes from
// ../data/kdp-figures.json (copied from KDP's help pages, with the date it was checked),
// never from a constant in this file. The tests compare the results with KDP's own
// worked examples and with the engine that lays out the books.

import figures from "../data/kdp-figures.json";

export const FIGURES = figures;

export type Ink = "bw_white" | "bw_cream" | "color_standard" | "color_premium";
export const INKS: readonly Ink[] = ["bw_white", "bw_cream", "color_standard", "color_premium"];

export interface TrimSpec {
  id: string;
  width: number;
  height: number;
  large: boolean;
  /** Page range per ink; null where KDP says "Not available". */
  pages: Record<Ink, [number, number] | null>;
}

const isLarge = (w: number, h: number) => w > figures.largeTrim.widthOver || h > figures.largeTrim.heightOver;

export const TRIM_SPECS: readonly TrimSpec[] = figures.trims.map((t) => ({
  id: `${t.width}x${t.height}`,
  width: t.width,
  height: t.height,
  large: isLarge(t.width, t.height),
  pages: t.pages as TrimSpec["pages"],
}));

export const trimSpec = (id: string): TrimSpec | undefined => TRIM_SPECS.find((t) => t.id === id);

/** Round to `d` decimals without the usual 1.005 surprises. */
export const round = (x: number, d: number): number => Number(Math.round(Number(`${x}e${d}`)) + `e-${d}`);

/** Pages KDP accepts for this trim and ink, or null when that combination isn't sold. */
export function pageRange(trim: TrimSpec, ink: Ink): [number, number] | null {
  return trim.pages[ink];
}

export function pagesProblem(trim: TrimSpec, ink: Ink, pages: number): "format" | "unavailable" | "low" | "high" | null {
  if (!Number.isInteger(pages) || pages <= 0) return "format";
  const r = pageRange(trim, ink);
  if (!r) return "unavailable";
  if (pages < r[0]) return "low";
  if (pages > r[1]) return "high";
  return null;
}

// ---- Spine and cover (KDP "Create a Paperback Cover") ----

export const spineWidth = (pages: number, ink: Ink): number => pages * figures.spinePerPage[ink];
export const spineHasText = (pages: number): boolean => pages >= figures.spineTextMinPages;

export interface CoverSize {
  spine: number;
  width: number;
  height: number;
  bleed: number;
  trimWidth: number;
  trimHeight: number;
}

/** Cover Width = Bleed + Back + Spine + Front + Bleed; Cover Height = Bleed + Trim Height + Bleed. */
export function coverSize(trim: { width: number; height: number }, pages: number, ink: Ink): CoverSize {
  const bleed = figures.bleed;
  const spine = spineWidth(pages, ink);
  return { spine, width: bleed + trim.width + spine + trim.width + bleed, height: bleed + trim.height + bleed, bleed, trimWidth: trim.width, trimHeight: trim.height };
}

/** 300 ppi is KDP's minimum for cover images. */
export const coverPixels = (c: CoverSize, ppi = 300): { width: number; height: number } => ({ width: Math.ceil(c.width * ppi), height: Math.ceil(c.height * ppi) });

// ---- Margins (KDP "Set Trim Size, Bleed, and Margins") ----

export function insideMargin(pages: number): number | null {
  return figures.margins.inside.find((r) => pages >= r.from && pages <= r.to)?.inches ?? null;
}

export interface Margins {
  inside: number;
  outside: number;
  top: number;
  bottom: number;
  /** Page size to export: trim plus bleed (0.125 in outside, top and bottom). */
  pageWidth: number;
  pageHeight: number;
  textWidth: number;
  textHeight: number;
}

export function margins(trim: { width: number; height: number }, pages: number, bleed: boolean): Margins | null {
  const inside = insideMargin(pages);
  if (inside === null) return null;
  const outside = bleed ? figures.margins.outsideBleed : figures.margins.outsideNoBleed;
  const b = bleed ? figures.bleed : 0;
  return { inside, outside, top: outside, bottom: outside, pageWidth: trim.width + b, pageHeight: trim.height + 2 * b, textWidth: trim.width - inside - outside, textHeight: trim.height - 2 * outside };
}

// ---- Printing cost and royalty (KDP "Paperback Printing Cost" and "Paperback Royalty", Amazon.com) ----

export function printingCost(trim: TrimSpec, ink: Ink, pages: number): number {
  const band = figures.printCost[ink];
  const rate = trim.large ? band.large : band.regular;
  return pages <= band.flatUpTo ? rate.flat : rate.fixed + pages * rate.perPage;
}

/** The share KDP pays at a list price on Amazon.com: 50% up to 9.98, 60% from 9.99. */
export const royaltyRate = (list: number): number => (list >= figures.royalty.highFrom ? figures.royalty.highRate : figures.royalty.lowRate);

export function royalty(list: number, cost: number, expanded = false): number {
  return (expanded ? figures.royalty.expandedRate : royaltyRate(list)) * list - cost;
}

/** Smallest list price KDP lets you enter on Amazon.com: the printing cost divided by the royalty rate. */
export function minListPrice(cost: number): number {
  const low = Math.ceil(round(cost / figures.royalty.lowRate, 6) * 100) / 100;
  if (low <= figures.royalty.lowUpTo) return low;
  const high = Math.ceil(round(cost / figures.royalty.highRate, 6) * 100) / 100;
  return Math.max(high, figures.royalty.highFrom);
}

// ---- Words to pages ----

export interface WordsToPages {
  pages: number;
  wordsPerPage: number;
  textPages: number;
}

/**
 * An estimate, not a layout: lines that fit in the text block times the words that fit on a line, with a
 * 10% allowance for paragraph ends and a page and a half lost at every chapter start. Add the front and back
 * matter, then round up to a whole sheet (two pages). Book Studio's own layout gives the exact count.
 */
export function wordsToPages(o: { words: number; trim: { width: number; height: number }; fontPt: number; leading: number; chapters: number; frontBack: number }): WordsToPages | null {
  if (!(o.words > 0)) return null;
  const outside = figures.margins.outsideNoBleed;
  const run = (inside: number) => {
    const textW = (o.trim.width - inside - outside) * 72;
    const textH = (o.trim.height - 2 * outside) * 72 - 36; // room for a running head and a folio
    const lines = Math.floor(textH / (o.fontPt * o.leading));
    const wordsPerPage = Math.max(1, Math.floor(lines * (textW / (o.fontPt * 0.45) / 6) * 0.9));
    const textPages = Math.ceil(o.words / wordsPerPage + o.chapters * 1.5);
    const total = textPages + o.frontBack;
    return { pages: total + (total % 2), wordsPerPage, textPages };
  };
  // The inside margin grows with the page count, so settle it with a second pass.
  const first = run(0.5);
  return run(insideMargin(first.pages) ?? 0.5);
}
