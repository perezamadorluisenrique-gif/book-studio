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
import { BLEED, type Trim } from "../trims";

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
}

export function coverGeometry(trim: Trim, pages: number, paper: Paper = "white"): CoverGeometry {
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
