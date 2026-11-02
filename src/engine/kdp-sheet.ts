// A sheet of everything KDP's "Kindle eBook / Paperback Details" page asks for,
// worked out from the manifest and ready to paste, with the limits KDP applies
// checked on the way.

import { checkIsbn, displayIsbn } from "./cover/isbn";
import type { Book } from "./model";
import { PAPER_LABEL } from "./cover/geometry";

export const KDP_LIMITS = { title: 200, subtitle: 200, keywords: 7, keywordLength: 50, description: 4000 } as const;

export interface SheetField {
  label: string;
  /** Plain text to paste; empty when the manifest doesn't give it. */
  value: string;
  /** A rule KDP applies that this value breaks. */
  problem?: string;
}

export interface KdpSheet {
  fields: SheetField[];
  /** What is still missing or over a limit, as sentences. */
  problems: string[];
  /** The sheet as plain text, one field after another. */
  text: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** KDP's description box takes a small set of HTML tags; paragraphs and emphasis are enough. */
export function descriptionHtml(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}

export function buildKdpSheet(book: Book, pages: number): KdpSheet {
  const { meta, settings } = book;
  const fields: SheetField[] = [];
  const add = (label: string, value: string | undefined, problem?: string) => fields.push({ label, value: value ?? "", problem });

  add("Title", meta.title, meta.title.length > KDP_LIMITS.title ? `KDP allows ${KDP_LIMITS.title} characters in the title; this has ${meta.title.length}.` : undefined);
  add("Subtitle", meta.subtitle, meta.subtitle && meta.subtitle.length > KDP_LIMITS.subtitle ? `KDP allows ${KDP_LIMITS.subtitle} characters in the subtitle.` : undefined);
  add("Series", meta.series ? `${meta.series}${meta.seriesNumber ? `, book ${meta.seriesNumber}` : ""}` : undefined);
  add("Edition", meta.edition);
  add(meta.authors.length > 1 ? "Authors" : "Author", meta.authors.join(", "), meta.authors.length ? undefined : "No author in the manifest.");

  const blurb = meta.coverDesign.blurb;
  const description = descriptionHtml(blurb);
  add("Description (HTML)", description, !blurb.length ? "No description: add description (or back-blurb) to the manifest." : description.length > KDP_LIMITS.description ? `KDP allows ${KDP_LIMITS.description} characters; this has ${description.length}.` : undefined);

  const keywords = meta.subjects;
  const long = keywords.filter((k) => k.length > KDP_LIMITS.keywordLength);
  add(
    "Keywords",
    keywords.slice(0, KDP_LIMITS.keywords).join("\n"),
    !keywords.length
      ? "No keywords: add keywords: to the manifest (KDP takes up to 7 phrases)."
      : keywords.length > KDP_LIMITS.keywords
        ? `KDP takes ${KDP_LIMITS.keywords} keywords; ${keywords.length} are listed, so only the first ${KDP_LIMITS.keywords} are shown.`
        : long.length
          ? `A keyword is over ${KDP_LIMITS.keywordLength} characters: ${long[0]}`
          : undefined,
  );

  const isbn = meta.isbnPrint ? checkIsbn(meta.isbnPrint) : null;
  add("Print ISBN", isbn?.ok && meta.isbnPrint ? displayIsbn(meta.isbnPrint, isbn.isbn13) : meta.isbnPrint, isbn && !isbn.ok ? `The ISBN ${meta.isbnPrint} isn't valid.` : undefined);
  add("Language", meta.language);
  add("Publication date", meta.year);
  add("Publisher", meta.publisher);
  add("Trim size", `${book.settings.trim.replace("x", " × ")} in`);
  add("Interior", settings.paper === "color" ? "Premium color" : `Black & white, ${PAPER_LABEL[settings.paper]}`);
  add("Bleed", settings.bleed ? "Bleed" : "No bleed");
  add("Page count", String(pages));

  const problems = fields.flatMap((f) => (f.problem ? [f.problem] : []));
  const text = fields.map((f) => `${f.label}\n${f.value || "(not set)"}`).join("\n\n");
  return { fields, problems, text };
}
