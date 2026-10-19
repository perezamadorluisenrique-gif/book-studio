// Build a book and its outputs. Shared by both hosts and the sample script;
// the plan decides what the outputs include, never what can be previewed.

import { PRODUCT_NAME, VERSION } from "../config";
import { auditBook, type AuditResult } from "../engine/a11y";
import { accessibilityReport } from "../engine/a11y-report";
import { loadBook, type VaultSource } from "../engine/book";
import { epubBlockers, hasFeature, printBlockers, type ExportBlocker, type Plan } from "../engine/entitlements";
import { bookSlug, writeEpub } from "../engine/epub";
import type { FontSet } from "../engine/fonts";
import { layoutBook, type Layout } from "../engine/layout/index";
import type { Book, BookSettings } from "../engine/model";
import { writePdf } from "../engine/pdf";

export const GENERATOR = `${PRODUCT_NAME} ${VERSION}`;

export interface Built {
  book: Book;
  layout: Layout;
  audit: AuditResult;
  ms: number;
}

export async function buildBook(source: VaultSource, manifestPath: string, fonts: FontSet, overrides: Partial<BookSettings> = {}): Promise<Built> {
  const t0 = performance.now();
  // Box sets always load so free users can preview them; exporting one needs Pro.
  const book = await loadBook(source, manifestPath, overrides, { boxSets: true });
  const layout = layoutBook(book, fonts);
  const audit = auditBook(book, { pageList: true });
  return { book, layout, audit, ms: Math.round(performance.now() - t0) };
}

export const isBoxSet = (book: Book) => book.chapters.some((c) => c.volume);

/** KDP spine width in inches for the page count; white paper is 0.002252" a page, cream 0.0025". */
export function spineWidth(pages: number, paper: "white" | "cream" = "white"): number {
  return pages * (paper === "white" ? 0.002252 : 0.0025);
}

export function pdfBlockers(plan: Plan, built: Built): ExportBlocker[] {
  return printBlockers(plan, built.book.settings, { boxSet: isBoxSet(built.book) });
}

export function ebookBlockers(plan: Plan, built: Built): ExportBlocker[] {
  return epubBlockers(plan, built.book.settings, { boxSet: isBoxSet(built.book) });
}

export async function exportPdf(built: Built, fonts: FontSet): Promise<{ name: string; data: Uint8Array }> {
  const data = await writePdf(built.book, built.layout, fonts, { producer: GENERATOR });
  return { name: `${bookSlug(built.book)}-paperback-${built.layout.trim.id}.pdf`, data };
}

export interface EpubChoices {
  /** Declare conformance when the audit passes (Pro). */
  claim: boolean;
  certifiedBy?: string;
}

export async function exportEpub(built: Built, fonts: FontSet, plan: Plan, choices: EpubChoices): Promise<{ name: string; data: Uint8Array }> {
  const pack = hasFeature(plan, "accessiblePack");
  // The page list names print pages, so it only goes in when that print edition can be made.
  const printable = pdfBlockers(plan, built).length === 0;
  const data = await writeEpub(built.book, {
    accessiblePack: pack,
    layout: printable ? built.layout : undefined,
    audit: pack ? built.audit : undefined,
    claimConformance: pack && choices.claim,
    certifiedBy: choices.certifiedBy || undefined,
    fonts,
    generator: GENERATOR,
  });
  return { name: `${bookSlug(built.book)}.epub`, data };
}

export function exportReport(built: Built, plan: Plan, choices: EpubChoices): { name: string; data: string } {
  const pageList = pdfBlockers(plan, built).length === 0;
  const claimed = choices.claim && built.audit.passed;
  const certifiedBy = choices.certifiedBy || built.book.meta.publisher || built.book.meta.authors.join(", ") || undefined;
  const data = accessibilityReport(built.book, built.audit, { claimed, certifiedBy: claimed ? certifiedBy : undefined, pageList, generator: GENERATOR });
  return { name: `${bookSlug(built.book)}-accessibility-report.html`, data };
}
