// What each plan includes. The engine never looks at a plan: hosts ask these
// functions before a build or export and pass the answers to the engine.
//
// Free, for good: any number of books, the Classic and Modern themes, the three
// most common trims (6" × 9", 5" × 8", 5.5" × 8.5"), print PDF, EPUB 3 with its
// basic accessibility metadata, and the preview of everything. What 0.1.x let
// people do is never taken away; tests/entitlements.test.ts holds that line.
// Pro: every trim and theme (including Large Print), box sets, the KDP preflight,
// the full cover, real footnotes, the back-of-book index, several editions at
// once, the KDP metadata sheet, and the accessible-EPUB pack.

import type { BookSettings } from "./model";
import { FREE_TRIMS } from "./trims";

export type Plan = "free" | "pro";

export const FREE_THEMES: readonly string[] = ["classic", "modern"];
export { FREE_TRIMS };

export type ProFeature = "theme" | "trim" | "accessiblePack" | "boxSets" | "largePrint" | "preflight" | "cover" | "footnotes" | "index" | "editions" | "kdpSheet";

export const PRO_FEATURES: Record<ProFeature, string> = {
  theme: "Every theme, including Elegant, Non-fiction, Thriller, Romance and Fantasy",
  trim: "All twelve KDP trim sizes",
  largePrint: "Large-print edition",
  preflight: "KDP preflight: checks the finished PDF against KDP's rules before you upload it",
  cover: "Full paperback cover: back, spine and front on one sheet, with spine width, bleed and barcode area",
  footnotes: "Real footnotes at the foot of the page, and a back-of-book index",
  index: "Back-of-book index with page numbers in print and links in the EPUB",
  editions: "Several editions of one book (paperback, large print, …) exported in one go",
  kdpSheet: "A KDP metadata sheet ready to paste: title, series, keywords, description",
  boxSets: "Box sets that combine several books",
  accessiblePack: "Accessible EPUB pack: image-description audit, conformance claim and report",
};

export function themeAllowed(plan: Plan, theme: string): boolean {
  return plan === "pro" || FREE_THEMES.includes(theme);
}

export function trimAllowed(plan: Plan, trim: string): boolean {
  return plan === "pro" || FREE_TRIMS.includes(trim);
}

/** Features that are wholly Pro; themes and trims are partly free, see above. */
export function hasFeature(plan: Plan, _feature: Exclude<ProFeature, "theme" | "trim">): boolean {
  return plan === "pro";
}

export interface ExportBlocker {
  feature: ProFeature;
  message: string;
}

/**
 * Why a print export isn't included in the plan, if it isn't. Free users can
 * preview Pro themes and trims, and export a watermarked sample of them; only
 * the clean export needs Pro.
 */
export function printBlockers(plan: Plan, settings: Pick<BookSettings, "theme" | "trim">, opts: { boxSet?: boolean } = {}): ExportBlocker[] {
  if (plan === "pro") return [];
  const out: ExportBlocker[] = [];
  if (settings.theme === "large-print") out.push({ feature: "largePrint", message: "The Large Print theme is part of Book Studio Pro." });
  else if (!themeAllowed(plan, settings.theme)) out.push({ feature: "theme", message: `The ${settings.theme} theme is part of Book Studio Pro. Free includes Classic and Modern.` });
  if (!trimAllowed(plan, settings.trim)) out.push({ feature: "trim", message: `The ${settings.trim} trim is part of Book Studio Pro. Free prints at 6" × 9", 5" × 8" and 5.5" × 8.5".` });
  if (opts.boxSet) out.push({ feature: "boxSets", message: "Box sets are part of Book Studio Pro." });
  return out;
}

/**
 * Why an EPUB export isn't included, if it isn't. The theme only styles the
 * EPUB lightly, so free users can export any theme's EPUB except Large Print;
 * the trim doesn't apply to an EPUB.
 */
export function epubBlockers(plan: Plan, settings: Pick<BookSettings, "theme">, opts: { boxSet?: boolean } = {}): ExportBlocker[] {
  if (plan === "pro") return [];
  const out: ExportBlocker[] = [];
  if (!themeAllowed(plan, settings.theme)) out.push({ feature: settings.theme === "large-print" ? "largePrint" : "theme", message: `The ${settings.theme} theme is part of Book Studio Pro. Free includes Classic and Modern.` });
  if (opts.boxSet) out.push({ feature: "boxSets", message: "Box sets are part of Book Studio Pro." });
  return out;
}
