// The KDP preflight: rules KDP applies to a paperback interior, checked on the
// laid-out book and on the PDF Book Studio wrote, before anything is uploaded.
// Each finding says what is wrong and where. A pass is not a promise: KDP's own
// review has the last word.
//
// Sources: KDP "Set trim size, bleed, and margins" (24 to 828 pages, inside margin
// by page count, 0.25" outside margins or 0.375" with bleed), "Create a paperback
// manuscript" (fonts embedded, 300 ppi images, 650 MB file limit).

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream } from "pdf-lib";
import { composeCover } from "./cover/cover";
import { checkIsbn } from "./cover/isbn";
import { SPINE_TEXT_MIN_PAGES } from "./cover/geometry";
import type { FontSet } from "./fonts";
import type { Layout } from "./layout/types";
import type { Book, SourceRef } from "./model";
import { BLEED, KDP_MAX_PAGES, KDP_MIN_PAGES, kdpMinInside, kdpMinOutside } from "./trims";

export type PreflightSeverity = "error" | "warning" | "info";

export interface PreflightFinding {
  rule: string;
  severity: PreflightSeverity;
  message: string;
  /** Printed page number, when the finding is about one page. */
  page?: string;
  src?: SourceRef;
}

export interface PreflightRule {
  id: string;
  title: string;
  /** Needs the written PDF, not just the layout. */
  pdf?: boolean;
}

export interface PreflightReport {
  findings: PreflightFinding[];
  /** Rules that ran and found nothing. */
  passed: PreflightRule[];
  /** Rules that couldn't run for lack of a PDF. */
  skipped: PreflightRule[];
  errors: number;
  warnings: number;
  /** No errors: nothing here will make KDP refuse the file. */
  ok: boolean;
  pages: number;
}

export interface PreflightInput {
  book: Book;
  layout: Layout;
  fonts: FontSet;
  /** The PDF as written, for the checks that need the file itself. */
  pdf?: Uint8Array;
}

export const KDP_MAX_FILE_BYTES = 650 * 1024 * 1024;
export const TARGET_PPI = 300;
export const LOW_PPI = 150;
/** More blank pages in a row than this look like a mistake. */
export const MAX_BLANK_RUN = 2;

export const PREFLIGHT_DISCLAIMER = "The preflight reduces rejections; KDP's own review makes the final decision.";

type Rule = PreflightRule & { run(input: PreflightInput, facts: PdfFacts | null): PreflightFinding[] | Promise<PreflightFinding[]> };

const inch = (pt: number) => pt / 72;
const fmtIn = (n: number) => n.toFixed(3).replace(/\.?0+$/, "");

function folioOf(layout: Layout, index: number): string {
  return layout.pages[index]?.folio ?? String(index + 1);
}

const RULES: Rule[] = [
  {
    id: "page-count",
    title: `${KDP_MIN_PAGES} to ${KDP_MAX_PAGES} pages`,
    run: ({ layout }) => {
      const n = layout.pages.length;
      if (n < KDP_MIN_PAGES) return [{ rule: "page-count", severity: "error", message: `The book has ${n} pages; KDP paperbacks need at least ${KDP_MIN_PAGES}. Add pages or blank pages at the end.` }];
      if (n > KDP_MAX_PAGES) return [{ rule: "page-count", severity: "error", message: `The book has ${n} pages; KDP paperbacks allow at most ${KDP_MAX_PAGES}. Use a larger trim size, a smaller type size, or split the book into volumes.` }];
      return [];
    },
  },
  {
    id: "inside-margin",
    title: "Inside margin for the page count",
    run: ({ layout }) => {
      const need = kdpMinInside(layout.pages.length);
      const have = inch(layout.margins.inside);
      return have + 1e-6 < need ? [{ rule: "inside-margin", severity: "error", message: `The inside margin is ${fmtIn(have)} in; KDP needs at least ${need} in for ${layout.pages.length} pages.` }] : [];
    },
  },
  {
    id: "outside-margins",
    title: "Outside, top and bottom margins",
    run: ({ book, layout }) => {
      const need = kdpMinOutside(book.settings.bleed);
      const m = layout.margins;
      const low = (["top", "bottom", "outside"] as const).filter((k) => inch(m[k]) + 1e-6 < need);
      return low.length ? [{ rule: "outside-margins", severity: "error", message: `The ${low.join(", ")} margin${low.length > 1 ? "s are" : " is"} under KDP's ${need} in minimum${book.settings.bleed ? " with bleed" : ""}.` }] : [];
    },
  },
  {
    id: "text-safe",
    title: "Text inside the safe area",
    run: ({ book, layout, fonts }) => {
      const out: PreflightFinding[] = [];
      const minOut = kdpMinOutside(book.settings.bleed) * 72;
      const gutter = kdpMinInside(layout.pages.length) * 72;
      const W = layout.widthPt;
      const H = layout.heightPt;
      for (const page of layout.pages) {
        const left = page.recto ? gutter : minOut;
        const right = W - (page.recto ? minOut : gutter);
        let bad = false;
        for (const d of page.draws) {
          if (d.kind !== "text" || !d.text.trim()) continue;
          // Cap height and descender are close enough to 0.75 and 0.25 of the size for a margin check.
          const outside = d.x < left - 0.01 || d.y - d.size * 0.75 < minOut - 0.01 || d.y + d.size * 0.25 > H - minOut + 0.01 || d.x + fonts.width(d.face, d.text, d.size, d.tracking ?? 0) > right + 0.01;
          if (outside) {
            bad = true;
            break;
          }
        }
        if (bad) out.push({ rule: "text-safe", severity: "error", message: "Text on this page reaches into KDP's margin, where it can be trimmed.", page: page.folio });
        if (out.length >= 10) break;
      }
      return out;
    },
  },
  {
    id: "image-resolution",
    title: `Images at ${TARGET_PPI} ppi or more`,
    run: ({ book, layout }) => {
      const out: PreflightFinding[] = [];
      for (const page of layout.pages) {
        for (const d of page.draws) {
          if (d.kind !== "image") continue;
          const asset = book.images.get(d.path);
          if (!asset || d.w <= 0) continue;
          const ppi = asset.width / inch(d.w);
          if (ppi < TARGET_PPI - 0.5) {
            out.push({
              rule: "image-resolution",
              severity: "warning",
              message: `${d.path.split("/").pop()} prints at ${Math.round(ppi)} ppi${ppi < LOW_PPI ? ", which will look soft" : ""}. KDP recommends ${TARGET_PPI} ppi; this image would need ${Math.ceil(inch(d.w) * TARGET_PPI)} pixels across.`,
              page: page.folio,
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: "image-edge",
    title: "Images that reach the page edge have bleed",
    run: ({ book, layout }) => {
      if (book.settings.bleed) return [];
      const out: PreflightFinding[] = [];
      for (const page of layout.pages) {
        for (const d of page.draws) {
          if (d.kind !== "image") continue;
          if (d.x <= 0.5 || d.y <= 0.5 || d.x + d.w >= layout.widthPt - 0.5 || d.y + d.h >= layout.heightPt - 0.5) {
            out.push({ rule: "image-edge", severity: "error", message: "An image reaches the edge of the page but bleed is off. Turn bleed on, or keep the image inside the margins.", page: page.folio });
          }
        }
      }
      return out;
    },
  },
  {
    id: "transparency",
    title: "No transparent images",
    run: ({ book }) => {
      const out: PreflightFinding[] = [];
      for (const [path, asset] of book.images) if (asset.alpha) out.push({ rule: "transparency", severity: "warning", message: `${path.split("/").pop()} has transparency. Printers flatten it onto white, which can change how it looks; export it without an alpha channel.` });
      return out;
    },
  },
  {
    id: "blank-pages",
    title: "No runs of blank pages",
    run: ({ layout }) => {
      const out: PreflightFinding[] = [];
      const pages = layout.pages;
      // Blank pages at the very end are padding to the page minimum, not a layout slip.
      let last = pages.length - 1;
      while (last >= 0 && pages[last].role === "blank") last--;
      let run = 0;
      for (let i = 0; i <= last; i++) {
        if (pages[i].role === "blank") run++;
        else {
          if (run > MAX_BLANK_RUN) out.push({ rule: "blank-pages", severity: "warning", message: `${run} blank pages in a row, from page ${folioOf(layout, i - run)} to ${folioOf(layout, i - 1)}.`, page: folioOf(layout, i - run) });
          run = 0;
        }
      }
      return out;
    },
  },
  {
    id: "isbn",
    title: "ISBN is valid",
    run: ({ book }) => {
      const isbn = book.meta.isbnPrint;
      if (!isbn) return [{ rule: "isbn", severity: "info", message: "No print ISBN in the manifest. KDP can assign a free one when you publish." }];
      const c = checkIsbn(isbn);
      if (c.ok) return [];
      const why = c.reason === "checksum" ? "its check digit is wrong" : c.reason === "prefix" ? "it doesn't start with 978 or 979" : "it needs 10 or 13 digits";
      return [{ rule: "isbn", severity: "error", message: `The ISBN ${isbn} isn't valid: ${why}.` }];
    },
  },
  {
    id: "metadata",
    title: "Title and author set",
    run: ({ book }) => {
      const out: PreflightFinding[] = [];
      if (!book.meta.authors.length) out.push({ rule: "metadata", severity: "warning", message: "No author in the manifest. KDP asks for the author's name, and it goes on the title page and copyright page." });
      if (!book.meta.title.trim()) out.push({ rule: "metadata", severity: "error", message: "The book has no title." });
      return out;
    },
  },
  {
    id: "spine-text",
    title: "Spine text only where KDP allows it",
    run: ({ layout }) => (layout.pages.length < SPINE_TEXT_MIN_PAGES ? [{ rule: "spine-text", severity: "info", message: `With ${layout.pages.length} pages the spine is too thin for text (KDP needs ${SPINE_TEXT_MIN_PAGES}), so the cover leaves it blank.` }] : []),
  },
  {
    id: "cover",
    title: "Cover ready",
    run: ({ book, layout, fonts }) => composeCover(book, fonts, layout.pages.length).findings.filter((f) => f.severity !== "info").map((f) => ({ rule: "cover", severity: f.severity, message: `Cover: ${f.message}` })),
  },
  {
    id: "pdf-pages",
    title: "PDF has the same pages",
    pdf: true,
    run: ({ layout }, facts) => (facts && facts.pageCount !== layout.pages.length ? [{ rule: "pdf-pages", severity: "error", message: `The PDF has ${facts.pageCount} pages but the layout has ${layout.pages.length}.` }] : []),
  },
  {
    id: "pdf-size",
    title: "PDF page size matches the trim",
    pdf: true,
    run: ({ book, layout }, facts) => {
      if (!facts) return [];
      const b = book.settings.bleed ? BLEED * 72 : 0;
      const w = layout.widthPt + b;
      const h = layout.heightPt + 2 * b;
      const off = facts.sizes.findIndex((s) => Math.abs(s.w - w) > 0.5 || Math.abs(s.h - h) > 0.5);
      return off < 0 ? [] : [{ rule: "pdf-size", severity: "error", message: `Page ${folioOf(layout, off)} is ${fmtIn(facts.sizes[off].w / 72)} × ${fmtIn(facts.sizes[off].h / 72)} in; the ${layout.trim.label} trim${b ? " with bleed" : ""} should be ${fmtIn(w / 72)} × ${fmtIn(h / 72)} in.`, page: folioOf(layout, off) }];
    },
  },
  {
    id: "pdf-fonts",
    title: "Every font is embedded",
    pdf: true,
    run: (_, facts) => (facts?.unembedded.length ? [{ rule: "pdf-fonts", severity: "error", message: `These fonts are not embedded in the PDF: ${facts.unembedded.join(", ")}. KDP rejects files with missing fonts.` }] : []),
  },
  {
    id: "pdf-file-size",
    title: "File under KDP's 650 MB limit",
    pdf: true,
    run: (_, facts) => (facts && facts.bytes > KDP_MAX_FILE_BYTES ? [{ rule: "pdf-file-size", severity: "error", message: `The PDF is ${Math.round(facts.bytes / 1024 / 1024)} MB; KDP accepts at most 650 MB. Use smaller images.` }] : []),
  },
];

export const PREFLIGHT_RULES: readonly PreflightRule[] = RULES.map(({ id, title, pdf }) => ({ id, title, pdf }));

interface PdfFacts {
  pageCount: number;
  sizes: { w: number; h: number }[];
  /** Base names of fonts without an embedded font file. */
  unembedded: string[];
  bytes: number;
}

export async function pdfFacts(bytes: Uint8Array): Promise<PdfFacts> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const sizes = doc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() }));
  const unembedded = new Set<string>();
  const seen = new Set<PDFRef>();
  const embedded = (font: PDFDict): boolean => {
    const desc = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.lookupMaybe(0, PDFDict);
    const d = (desc ?? font).lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (!d) return false;
    return [PDFName.of("FontFile"), PDFName.of("FontFile2"), PDFName.of("FontFile3")].some((k) => d.lookup(k) instanceof PDFStream);
  };
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fonts) continue;
    for (const [, value] of fonts.entries()) {
      if (value instanceof PDFRef) {
        if (seen.has(value)) continue;
        seen.add(value);
      }
      const font = doc.context.lookupMaybe(value, PDFDict);
      if (!font || embedded(font)) continue;
      unembedded.add(font.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "unknown");
    }
  }
  return { pageCount: sizes.length, sizes, unembedded: [...unembedded], bytes: bytes.length };
}

export async function runPreflight(input: PreflightInput): Promise<PreflightReport> {
  const facts = input.pdf ? await pdfFacts(input.pdf) : null;
  const findings: PreflightFinding[] = [];
  const passed: PreflightRule[] = [];
  const skipped: PreflightRule[] = [];
  for (const rule of RULES) {
    const info: PreflightRule = { id: rule.id, title: rule.title, pdf: rule.pdf };
    if (rule.pdf && !facts) {
      skipped.push(info);
      continue;
    }
    const found = await rule.run(input, facts);
    if (found.length) findings.push(...found);
    else passed.push(info);
  }
  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const errors = findings.filter((f) => f.severity === "error").length;
  return { findings, passed, skipped, errors, warnings: findings.filter((f) => f.severity === "warning").length, ok: errors === 0, pages: input.layout.pages.length };
}
