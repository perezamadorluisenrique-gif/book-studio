// What each plan includes. The engine never looks at a plan: hosts ask these
// functions before a build or export and pass the answers to the engine.
//
// Free, for good: any number of books; every KDP trim; the Classic, Modern, Elegant,
// Non-fiction and Large Print themes; print PDF with real footnotes at the foot of the
// page; the full paperback cover; the KDP preflight and the KDP metadata sheet; EPUB 3
// with its basic accessibility metadata; and the preview of everything. What an earlier
// version let people do is never taken away; tests/entitlements.test.ts holds that line.
// Pro: the genre themes (Thriller, Romance, Fantasy and the ones to come), box sets, the
// back-of-book index, several editions at once, and the accessible-EPUB pack.

import type { BookSettings } from "./model";
import { FREE_TRIMS } from "./trims";

export type Plan = "free" | "pro";

export const FREE_THEMES: readonly string[] = ["classic", "modern", "elegant", "nonfiction", "large-print"];
export { FREE_TRIMS };

export type ProFeature = "theme" | "trim" | "accessiblePack" | "boxSets" | "largePrint" | "preflight" | "cover" | "footnotes" | "index" | "editions" | "kdpSheet";

/** Features that were Pro and are now free; they stay in the type so an old export blocker still reads right. */
export const FREE_FEATURES: readonly ProFeature[] = ["trim", "largePrint", "preflight", "cover", "footnotes", "kdpSheet"];

/** What only Pro has. */
type PaidFeature = "theme" | "index" | "editions" | "boxSets" | "accessiblePack";

/** What Pro adds, for the license screens. */
export const PRO_FEATURES: Record<PaidFeature, string> = {
  theme: "Genre themes: Thriller, Romance, Fantasy and more",
  index: "Back-of-book index with page numbers, set in two columns",
  editions: "Several editions of one book (paperback, large print, …) exported in one go",
  boxSets: "Box sets that combine several books",
  accessiblePack: "Accessible EPUB pack: image-description audit, conformance claim and report",
};

/** The eight free cover templates (the others are Pro). Listed here so a test can hold the line. */
export const FREE_COVER_TEMPLATE_IDS: readonly string[] = ["classic-navy", "classic-cream", "modern-bold", "clean-white", "red-band", "green-frame", "dusk", "picture-band"];

export function coverTemplateAllowed(plan: Plan, id: string): boolean {
  return plan === "pro" || FREE_COVER_TEMPLATE_IDS.includes(id);
}

export function themeAllowed(plan: Plan, theme: string): boolean {
  return plan === "pro" || FREE_THEMES.includes(theme);
}

/** True for what the plan includes. Free features are open to every plan. */
export function hasFeature(plan: Plan, feature: Exclude<ProFeature, "theme" | "trim">): boolean {
  return plan === "pro" || FREE_FEATURES.includes(feature);
}

export interface ExportBlocker {
  feature: ProFeature;
  message: string;
}

const FREE_THEMES_TEXT = "Free includes Classic, Modern, Elegant, Non-fiction and Large Print.";

/**
 * Why a print export isn't included in the plan, if it isn't. Free users can
 * preview Pro themes and export a watermarked sample of them; only the clean
 * export needs Pro.
 */
export function printBlockers(plan: Plan, settings: Pick<BookSettings, "theme" | "trim"> & Partial<Pick<BookSettings, "footnotes">>, opts: { boxSet?: boolean; index?: boolean } = {}): ExportBlocker[] {
  if (plan === "pro") return [];
  const out: ExportBlocker[] = [];
  if (!themeAllowed(plan, settings.theme)) out.push({ feature: "theme", message: `The ${settings.theme} theme is part of Book Studio Pro. ${FREE_THEMES_TEXT}` });
  if (opts.index) out.push({ feature: "index", message: "The back-of-book index is part of Book Studio Pro. Remove index-terms from the book note to export without it." });
  if (opts.boxSet) out.push({ feature: "boxSets", message: "Box sets are part of Book Studio Pro." });
  return out;
}

/**
 * Why an EPUB export isn't included, if it isn't. The theme only styles the
 * EPUB lightly; the trim doesn't apply to an EPUB.
 */
export function epubBlockers(plan: Plan, settings: Pick<BookSettings, "theme">, opts: { boxSet?: boolean } = {}): ExportBlocker[] {
  if (plan === "pro") return [];
  const out: ExportBlocker[] = [];
  if (!themeAllowed(plan, settings.theme)) out.push({ feature: "theme", message: `The ${settings.theme} theme is part of Book Studio Pro. ${FREE_THEMES_TEXT}` });
  if (opts.boxSet) out.push({ feature: "boxSets", message: "Box sets are part of Book Studio Pro." });
  return out;
}
