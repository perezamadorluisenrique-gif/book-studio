// The flat sheet KDP prints a paperback cover from: back cover, spine and front
// cover side by side, with bleed all round. Everything here is in inches and
// pure, so the numbers can be tested against KDP's published formula.
//
// Checked on 2026-11-10 against KDP's "Paperback cover" help page
// (kdp.amazon.com/en_US/help/topic/G201953020):
//   - spine per page: 0.002252 in black-and-white on white paper and standard colour,
//     0.0025 in on cream, 0.002347 in on premium colour (`color` here is premium);
//   - bleed 0.125 in on the top, bottom and outside edges;
//   - spine text only from 79 pages (80 in KDP's own Cover Creator), and kept
//     0.0625 in from the spine edge;
//   - KDP asks for text at least 0.125 in inside the trim and borders at least
//     0.25 in; we keep text 0.25 in inside, the stricter of the two.
// NOT on that page: the barcode size. 2 in × 1.2 in at the lower right of the back
// cover, 0.25 in from the trim, is the size of KDP's downloadable cover template and
// calculator layout, not something the help text states; it is unchanged and unverified.

import type { Paper } from "../model";
import { BLEED, type Binding, type Trim } from "../trims";

/** Spine thickness added by each page (a sheet is two pages), in inches. */
export const SPINE_PER_PAGE: Record<Paper, number> = {
  white: 0.002252,
  cream: 0.0025,
  color: 0.002347,
};

export const PAPER_LABEL: Record<Paper, string> = {
  white: "white paper",
  cream: "cream paper",
  color: "premium color paper",
};

/** Books with fewer pages than this don't get text on the spine. */
export const SPINE_TEXT_MIN_PAGES = 79;
export const SAFE = 0.25;
export const SPINE_SAFE = 0.0625;
export const BARCODE = { w: 2, h: 1.2 } as const;

// Hardcover (case laminate) cover sheet. Checked on 2026-11-17 against KDP's "Create a Hardcover Cover" help
// (kdp.amazon.com/en_US/help/topic/GDTKFJPNQCBTMRV6) and "Hardcover print elements" (GKZVNAAFYWVKZWL8):
//   - the cover file wraps around a 2 mm case board: the file runs 15 mm (0.591 in) past the edge of the cover.
//     The page prints "0.51"" next to "(15 mm)"; we follow the millimetres, which agree with 0.591;
//   - 10 mm (0.394 in) of hinge between the spine and the safe area on the front and back covers;
//   - barcode 2 in × 1.2 in, at least 0.76 in from the bottom and 0.25 in from the hinge; same size in the
//     lower right of the back cover when KDP assigns the ISBN;
//   - a black-and-white headband on the spine from 120 pages.
// NOT on those pages (they send the author to KDP's cover calculator): the spine width per page for a hardcover,
// the sheet's total width and height, and the spine text minimum. Unverified, from a third-party calculator that
// matches the 15 mm and 10 mm above: sheet width = 2 trim + spine + 0.394 + 2 × 0.591, height = trim + 0.236 +
// 2 × 0.591 (the board is a little taller than the pages); the paperback spine factors are reused. Until the
// numbers are checked against KDP's own template the cover says so in its findings.
export const HARDCOVER_COVER = { wrap: 0.591, hinge: 0.394, boardExtra: 0.236, verified: false } as const;

export const spineWidth = (pages: number, paper: Paper = "white"): number => pages * SPINE_PER_PAGE[paper];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoverGeometry {
  pages: number;
  paper: Paper;
  trim: Trim;
  bleed: number;
  spine: number;
  /** Whole sheet, bleed included. */
  width: number;
  height: number;
  /** Panels, measured from the top-left corner of the sheet. */
  back: Box;
  spineBox: Box;
  front: Box;
  /** The front panel and the bleed beyond it, where a cover image runs to the edge. */
  frontBleed: Box;
  barcode: Box;
  spineText: boolean;
  /** "hardcover" for a case-laminate sheet; absent for a paperback. */
  binding?: Binding;
  /** False when the sheet's figures come from no KDP page (hardcover). */
  verified?: boolean;
}

export function coverGeometry(trim: Trim, pages: number, paper: Paper = "white", binding: Binding = "paperback"): CoverGeometry {
  if (binding === "hardcover") return hardcoverGeometry(trim, pages, paper);
  const spine = spineWidth(pages, paper);
  const width = 2 * BLEED + 2 * trim.width + spine;
  const height = trim.height + 2 * BLEED;
  const back: Box = { x: BLEED, y: BLEED, w: trim.width, h: trim.height };
  const spineBox: Box = { x: BLEED + trim.width, y: BLEED, w: spine, h: trim.height };
  const front: Box = { x: BLEED + trim.width + spine, y: BLEED, w: trim.width, h: trim.height };
  const frontBleed: Box = { x: front.x, y: 0, w: trim.width + BLEED, h: height };
  const barcode: Box = { x: back.x + back.w - SAFE - BARCODE.w, y: back.y + back.h - SAFE - BARCODE.h, w: BARCODE.w, h: BARCODE.h };
  return { pages, paper, trim, bleed: BLEED, spine, width, height, back, spineBox, front, frontBleed, barcode, spineText: pages >= SPINE_TEXT_MIN_PAGES };
}

/** Pixels a flat cover image needs for 300 ppi at this size. */
export function coverPixels(g: CoverGeometry, ppi = 300): { width: number; height: number } {
  return { width: Math.ceil(g.width * ppi), height: Math.ceil(g.height * ppi) };
}

function hardcoverGeometry(trim: Trim, pages: number, paper: Paper): CoverGeometry {
  const { wrap, hinge, boardExtra, verified } = HARDCOVER_COVER;
  const spine = spineWidth(pages, paper);
  const width = 2 * wrap + 2 * trim.width + hinge + spine;
  const height = trim.height + boardExtra + 2 * wrap;
  const y = wrap + boardExtra / 2;
  const back: Box = { x: wrap, y, w: trim.width, h: trim.height };
  const spineBox: Box = { x: wrap + trim.width + hinge / 2, y, w: spine, h: trim.height };
  const front: Box = { x: wrap + trim.width + hinge + spine, y, w: trim.width, h: trim.height };
  const frontBleed: Box = { x: front.x, y: 0, w: trim.width + wrap, h: height };
  const barcode: Box = { x: back.x + back.w - SAFE - BARCODE.w, y: back.y + back.h - SAFE - BARCODE.h, w: BARCODE.w, h: BARCODE.h };
  return { pages, paper, trim, bleed: wrap, spine, width, height, back, spineBox, front, frontBleed, barcode, spineText: pages >= SPINE_TEXT_MIN_PAGES, binding: "hardcover", verified };
}
