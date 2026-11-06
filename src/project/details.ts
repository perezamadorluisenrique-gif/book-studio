// The book's details as a form sees them (title, author, ISBN, keywords…) and how they are kept in the
// project: each one is a line of the book note's front matter. Plain functions, no screen code, so they are easy to test.

import { checkIsbn } from "../engine/cover/isbn";
import { fmGet } from "../engine/manifest";
import type { Project } from "./model";

/** The most keywords KDP takes for a book. */
export const MAX_KEYWORDS = 7;

export type DetailField = "title" | "subtitle" | "author" | "language" | "publisher" | "isbnPrint" | "isbnEbook" | "copyright" | "dedication" | "epigraph" | "description" | "keywords" | "series";

export type BookDetails = Record<DetailField, string>;

/** Front matter key for each field (the first one is the one written), then the other spellings the engine also reads. */
const KEYS: Record<DetailField, string[]> = {
  title: ["title"],
  subtitle: ["subtitle"],
  author: ["author", "authors"],
  language: ["language", "lang"],
  publisher: ["publisher", "imprint"],
  isbnPrint: ["isbn", "isbn-print", "paperback-isbn", "print-isbn"],
  isbnEbook: ["ebook-isbn", "isbn-ebook", "epub-isbn"],
  copyright: ["copyright"],
  dedication: ["dedication"],
  epigraph: ["epigraph"],
  description: ["description", "blurb"],
  keywords: ["keywords", "subjects", "genre"],
  series: ["series"],
};

export const DETAIL_FIELDS = Object.keys(KEYS) as DetailField[];

const norm = (k: string) => k.toLowerCase().replace(/[\s_-]/g, "");

function read(meta: Record<string, string>, field: DetailField): string {
  const v = fmGet(meta, ...KEYS[field]);
  return typeof v === "string" ? v : "";
}

/** The details written in a project's front matter. */
export function readDetails(p: Project): BookDetails {
  const d = {} as BookDetails;
  for (const f of DETAIL_FIELDS) d[f] = read(p.meta, f);
  return d;
}

/** Change one detail. An empty value takes the line out of the front matter. */
export function setDetail(p: Project, field: DetailField, value: string, now: number): Project {
  const drop = new Set(KEYS[field].map(norm));
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.meta)) if (!drop.has(norm(k))) meta[k] = v;
  if (value.trim()) meta[KEYS[field][0]] = value;
  return { ...p, meta, updatedAt: now };
}

/** Change one layout setting (theme, trim…). */
export function setSetting(p: Project, key: string, value: string, now: number): Project {
  return { ...p, settings: { ...p.settings, [key]: value }, updatedAt: now };
}

// ── Checks ──

export type IsbnProblem = "format" | "checksum" | "prefix";

/** Why an ISBN is not valid, or null when it is valid or empty. */
export function isbnProblem(value: string): IsbnProblem | null {
  if (!value.trim()) return null;
  const r = checkIsbn(value);
  return r.ok ? null : r.reason;
}

/** Split typed keywords (separated by commas, semicolons or new lines), without repeats; `kept` is the most KDP accepts. */
export function parseKeywords(text: string): { all: string[]; kept: string[]; tooMany: boolean } {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const k = raw.replace(/\s+/g, " ").trim();
    if (k && !seen.has(k.toLowerCase())) {
      seen.add(k.toLowerCase());
      all.push(k);
    }
  }
  return { all, kept: all.slice(0, MAX_KEYWORDS), tooMany: all.length > MAX_KEYWORDS };
}

/** The keywords as the front matter line: at most seven, separated by commas. */
export function keywordsValue(text: string): string {
  return parseKeywords(text).kept.join(", ");
}
