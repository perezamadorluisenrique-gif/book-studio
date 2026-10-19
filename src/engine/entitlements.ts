// What each plan includes. The engine never looks at a plan: hosts ask these
// functions before a build or export and pass the answers to the engine.
//
// Free: one book, the Classic and Modern themes, 6" × 9" print, EPUB export.
// Pro:  every trim and theme (including Large Print), any number of books,
//       box sets, and the accessible-EPUB pack (accessibility metadata,
//       image-description audit, conformance claim and report).

import type { BookSettings } from "./model";
import { FREE_TRIM } from "./trims";

export type Plan = "free" | "pro";

export const FREE_THEMES: readonly string[] = ["classic", "modern"];
export { FREE_TRIM };

export type ProFeature = "theme" | "trim" | "multiBook" | "accessiblePack" | "boxSets" | "largePrint";

export const PRO_FEATURES: Record<ProFeature, string> = {
  theme: "All themes",
  trim: "All KDP trim sizes",
  multiBook: "Unlimited books",
  accessiblePack: "Accessible EPUB pack: accessibility metadata, image-description audit, conformance claim and report",
  boxSets: "Box sets that combine several books",
  largePrint: "Large-print edition",
};

export function themeAllowed(plan: Plan, theme: string): boolean {
  return plan === "pro" || FREE_THEMES.includes(theme);
}

export function trimAllowed(plan: Plan, trim: string): boolean {
  return plan === "pro" || trim === FREE_TRIM;
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
 * preview Pro themes and trims; only exporting them needs Pro.
 */
export function printBlockers(plan: Plan, settings: Pick<BookSettings, "theme" | "trim">, opts: { boxSet?: boolean } = {}): ExportBlocker[] {
  if (plan === "pro") return [];
  const out: ExportBlocker[] = [];
  if (settings.theme === "large-print") out.push({ feature: "largePrint", message: "The Large Print theme is part of Book Studio Pro." });
  else if (!themeAllowed(plan, settings.theme)) out.push({ feature: "theme", message: `The ${settings.theme} theme is part of Book Studio Pro. Free includes Classic and Modern.` });
  if (!trimAllowed(plan, settings.trim)) out.push({ feature: "trim", message: `The ${settings.trim} trim is part of Book Studio Pro. Free prints at 6" × 9".` });
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

/**
 * The free plan's one book. Hosts keep the book the person chose; they can
 * move the free plan to another book once every FREE_SWITCH_INTERVAL.
 */
export interface FreeBookState {
  path: string | null;
  /** When the free book last changed, ms since the epoch. */
  since?: number;
}

export const FREE_SWITCH_INTERVAL = 7 * 24 * 60 * 60 * 1000;

export type FreeBookCheck = { ok: true } | { ok: false; current: string; canSwitch: boolean; switchAt: number };

export function checkFreeBook(plan: Plan, state: FreeBookState, manifestPath: string, now = Date.now()): FreeBookCheck {
  if (plan === "pro" || !state.path || state.path === manifestPath) return { ok: true };
  const switchAt = (state.since ?? 0) + FREE_SWITCH_INTERVAL;
  return { ok: false, current: state.path, canSwitch: now >= switchAt, switchAt };
}

/** The state after making `manifestPath` the free book. */
export function chooseFreeBook(state: FreeBookState, manifestPath: string, now = Date.now()): FreeBookState {
  return state.path === manifestPath ? state : { path: manifestPath, since: now };
}
