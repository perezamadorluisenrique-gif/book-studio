// Paperback trim sizes and Amazon KDP's interior margin rules.
// Source: KDP "Set trim size, bleed, and margins" (inside margin by page count;
// outside margins at least 0.25" without bleed, 0.375" with bleed; bleed adds
// 0.125" to the outside edge and 0.125" to top and bottom).

export interface Trim {
  id: string;
  label: string;
  /** Inches. */
  width: number;
  height: number;
}

export const TRIMS: Trim[] = [
  { id: "5x8", label: '5" × 8"', width: 5, height: 8 },
  { id: "5.06x7.81", label: '5.06" × 7.81"', width: 5.06, height: 7.81 },
  { id: "5.25x8", label: '5.25" × 8"', width: 5.25, height: 8 },
  { id: "5.5x8.5", label: '5.5" × 8.5" (Digest)', width: 5.5, height: 8.5 },
  { id: "6x9", label: '6" × 9" (US Trade)', width: 6, height: 9 },
  { id: "6.14x9.21", label: '6.14" × 9.21" (Royal)', width: 6.14, height: 9.21 },
  { id: "6.69x9.61", label: '6.69" × 9.61"', width: 6.69, height: 9.61 },
  { id: "7x10", label: '7" × 10"', width: 7, height: 10 },
  { id: "7.44x9.69", label: '7.44" × 9.69" (Crown Quarto)', width: 7.44, height: 9.69 },
  { id: "7.5x9.25", label: '7.5" × 9.25"', width: 7.5, height: 9.25 },
  { id: "8x10", label: '8" × 10"', width: 8, height: 10 },
  { id: "8.5x11", label: '8.5" × 11" (Letter)', width: 8.5, height: 11 },
];

/** The default trim, and the one every plan can fall back to. */
export const DEFAULT_TRIM = "6x9";

/** The three best-selling KDP trims, free for good. */
export const FREE_TRIMS: readonly string[] = ["6x9", "5x8", "5.5x8.5"];

export function trimById(id: string): Trim | undefined {
  return TRIMS.find((t) => t.id === id);
}

export const KDP_MIN_PAGES = 24;
export const KDP_MAX_PAGES = 828;
export const BLEED = 0.125;

/** KDP's minimum inside (gutter) margin in inches for a page count. */
export function kdpMinInside(pageCount: number): number {
  if (pageCount <= 150) return 0.375;
  if (pageCount <= 300) return 0.5;
  if (pageCount <= 500) return 0.625;
  if (pageCount <= 700) return 0.75;
  return 0.875;
}

/** KDP's minimum outside margin (top, bottom, outside edge) in inches. */
export function kdpMinOutside(bleed: boolean): number {
  return bleed ? 0.375 : 0.25;
}
