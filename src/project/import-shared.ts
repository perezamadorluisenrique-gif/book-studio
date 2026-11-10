// What the Word, ODT and RTF importers share: the blocks they find, the Markdown written from them,
// the word-count guarantee and the report. Pure code, no file format in here.

import { countWords, importText, words, type ImportedBook } from "./import-text";
import type { ProjectAsset } from "./model";


/** What was left out or worth a look. Codes are turned into sentences by the screen. */
export type ReportCode = "mergedCells" | "tables" | "textBoxes" | "equations" | "comments" | "deletions" | "insertions" | "toc" | "oldPictures" | "unsupportedImages" | "imagesNoAlt";

export interface DocxReport {
  /** Each code with how many times it happened (only those that did). */
  items: { code: ReportCode; count: number }[];
  chapters: number;
  images: number;
  footnotes: number;
  /** Styles of your own that look like chapter titles; the screen asks once, then imports again with `titleStyles`. */
  titleStyles: { id: string; name: string; count: number; examples: string[] }[];
  /** The word-count guarantee: words in the Word file, words in the book, and what is missing. */
  words: WordCheck;
}

export interface WordCheck {
  source: number;
  book: number;
  /** Paragraphs of the Word file whose text is not in the book: the start of the text and the nearest heading before it. */
  missing: { texto: string; lugar: string }[];
}

export interface ImportedDocx extends ImportedBook {
  assets: ProjectAsset[];
  report: DocxReport;
  /** The Markdown the chapters were cut from (useful for tests and for debugging). */
  markdown: string;
}

const MARKDOWN_SPECIAL = /([\\*_[\]<>`])/g;
export const escapeText = (s: string): string => s.replace(MARKDOWN_SPECIAL, "\\$1");

export const SCENE = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|\*|#|~|[⁂❦])\s*$/;
const LEADING = /^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/;

export interface Block {
  kind: "heading" | "paragraph" | "quote" | "list" | "pageBreak" | "skip" | "table";
  level?: number;
  text: string;
  ordered?: boolean;
  depth?: number;
  title?: boolean;
  subtitle?: boolean;
  author?: boolean;
  align?: "center" | "right";
  /** Markdown lines of a table. */
  rows?: string[];
}

const END_PUNCT = /[.!?…:;»"”’)\]]$/;

/**
 * Tidy a paragraph: double spaces become one, and lines cut by hand in the middle of a sentence are joined
 * (only when more than 20 in a row end without punctuation and the lines are long, so poems keep their lines).
 */
export function cleanText(text: string): string {
  const lines = text.split("  \n").map((l) => l.replace(/[ \t]{2,}/g, " ").trim());
  if (lines.length <= 20) return lines.join("  \n");
  const out: string[] = [];
  let group: string[] = [];
  const flush = (): void => {
    const long = group.reduce((n, l) => n + l.length, 0) / group.length >= 45;
    if (group.length > 20 && long) out.push(group.join(" "));
    else out.push(...group);
    group = [];
  };
  for (const l of lines) {
    group.push(l);
    if (END_PUNCT.test(l.replace(/[*_\\]+$/, ""))) flush();
  }
  if (group.length) flush();
  return out.join("  \n");
}

export function lineSafe(text: string): string {
  return SCENE.test(text.replace(/\\\*/g, "*")) ? "* * *" : text.replace(LEADING, (_m, sp: string, mark: string) => `${sp}\\${mark}`);
}

export interface SourcePara {
  text: string;
  place: string;
}

/** The book's Markdown without its own syntax, so only words are left. */
function plainWords(markdown: string): string {
  return markdown
    .replace(/<!-- pagebreak -->/g, "")
    .replace(/!\[(?:\\.|[^\]\\])*\]\(<[^>]*>\)/g, "")
    .replace(/\[((?:\\.|[^\]\\])*)\]\(<[^>]*>\)/g, "$1")
    .replace(/\[\^\d+\]:?/g, "")
    .replace(/(?<!\\)<\/?(?:sup|sub|span|br)[^>]*>/g, (m) => (m.startsWith("<br") ? "\n\n" : ""))
    .replace(/\{\.(?:center|right)\}/g, "")
    .replace(/\\\|/g, " ")
    .replace(/\|/g, "\n\n")
    .replace(/^[ \t]*(?:\d+\.|-|>)[ \t]/gm, "");
}

const norm = (s: string): string => words(s).join(" ").toLowerCase();

export function checkWords(source: SourcePara[], markdown: string, extra: string[]): WordCheck {
  const plain = plainWords(markdown);
  const blocks = new Set<string>();
  for (const block of plain.split(/\n{2,}/)) {
    blocks.add(norm(block));
    for (const line of block.split("\n")) blocks.add(norm(line));
  }
  const whole = ` ${norm(plain)} ${extra.map(norm).join(" ")} `;
  for (const e of extra) blocks.add(norm(e));
  const missing: WordCheck["missing"] = [];
  let sourceWords = 0;
  for (const para of source) {
    sourceWords += countWords(para.text);
    const n = norm(para.text);
    // A short paragraph must be a block of its own: inside a longer text it could match by chance.
    if (blocks.has(n) || (n.split(" ").length >= 6 && whole.includes(` ${n} `))) continue;
    missing.push({ texto: para.text.length > 80 ? `${para.text.slice(0, 77)}…` : para.text, lugar: para.place });
  }
  return { source: sourceWords, book: countWords(plain) + extra.reduce((n, e) => n + countWords(e), 0), missing };
}


export interface Seg {
  text: string;
  b: boolean;
  i: boolean;
  /** Extra looks: s strike-through, c small caps, u superscript, d subscript. */
  x?: string;
}


/** Join segments into Markdown: adjacent text with the same bold/italic shares one pair of marks. */
export function render(c: unknown, segs: Seg[]): string {
  void c;
  const merged: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.b === s.b && last.i === s.i && (last.x ?? "") === (s.x ?? "") && !s.text.startsWith("\uE000") && !last.text.startsWith("\uE000")) last.text += s.text;
    else merged.push({ ...s });
  }
  let out = "";
  for (const s of merged) {
    if (s.text === "\uE000PB") {
      out += "\uE000PB\uE000";
      continue;
    }
    if (s.text === "\uE000BR") {
      out += "  \n";
      continue;
    }
    const raw = /^\uE000RAW([\s\S]*)\uE000$/.exec(s.text);
    if (raw) {
      out += raw[1];
      continue;
    }
    const lead = /^\s*/.exec(s.text)?.[0] ?? "";
    const tail = s.text.length > lead.length ? (/\s*$/.exec(s.text)?.[0] ?? "") : "";
    const core = s.text.slice(lead.length, s.text.length - tail.length);
    const mark = s.b && s.i ? "***" : s.b ? "**" : s.i ? "*" : "";
    let body = core ? `${mark}${escapeText(core)}${mark}` : "";
    if (core && s.x) {
      if (s.x.includes("s")) body = `~~${body}~~`;
      if (s.x.includes("c")) body = `<span class="sc">${body}</span>`;
      if (s.x.includes("u")) body = `<sup>${body}</sup>`;
      if (s.x.includes("d")) body = `<sub>${body}</sub>`;
    }
    out += core ? `${lead}${body}${tail}` : lead + tail;
  }
  return out.replace(/ {3,}\n/g, "  \n");
}


export const PAGE_BREAK = "<!-- pagebreak -->";

export const MAX_PART_BYTES = 60 * 1024 * 1024;

export interface FinishInput {
  blocks: Block[];
  /** Footnotes to write after the block at that index, as "number\uE000text". */
  notesAfter: Map<number, string[]>;
  fileName: string;
  assets: ProjectAsset[];
  counts: Map<ReportCode, number>;
  footnotes: number;
  source: SourcePara[];
  titleStyles: DocxReport["titleStyles"];
  meta: { title?: string; creator?: string; lang?: string };
}

/** Write the blocks as Markdown, cut it into chapters and add the report. */
export function finishImport(f: FinishInput): ImportedDocx {
  const { blocks, notesAfter } = f;
  // Which heading level starts a chapter: the highest one the document uses (1, 2 or 3).
  const levels = blocks.filter((b) => b.kind === "heading").map((b) => b.level ?? 1);
  const top = levels.length ? Math.min(...levels) : 1;
  const lines: string[] = [];
  let title: string | undefined;
  let author: string | undefined;
  let subtitle: string | undefined;
  const metaText: string[] = [];
  const plainMeta = (t: string): string => t.replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\*+/g, "");
  blocks.forEach((b, idx) => {
    const extra = notesAfter.get(idx);
    if (b.kind === "skip") return;
    if (b.kind === "pageBreak") lines.push(PAGE_BREAK, "");
    else if (b.kind === "heading") lines.push(`${"#".repeat(Math.min(4, Math.max(1, (b.level ?? 1) - top + 1)))} ${b.text}`, "");
    else if (b.title) {
      if (!title) metaText.push(b.text);
      title ??= plainMeta(b.text);
    } else if (b.author) {
      if (!author) metaText.push(b.text);
      author ??= plainMeta(b.text);
    } else if (b.subtitle) {
      if (!subtitle) metaText.push(b.text);
      subtitle ??= plainMeta(b.text);
    } else if (b.kind === "quote") lines.push(...b.text.split("  \n").map((l, k, all) => `> ${l}${k < all.length - 1 ? "  " : ""}`), "");
    else if (b.kind === "list") {
      lines.push(`${"    ".repeat(Math.min(b.depth ?? 0, 4))}${b.ordered ? "1." : "-"} ${b.text.replace(/ {2}\n/g, " ")}`);
      const next = blocks.slice(idx + 1).find((x) => x.kind !== "skip");
      if (next?.kind !== "list" || next.ordered !== b.ordered) lines.push("");
    } else if (b.kind === "table") lines.push(...(b.rows ?? []), "");
    else {
      const safe = b.text.split("  \n").length > 1 ? b.text : lineSafe(b.text);
      lines.push(b.align && safe !== "* * *" ? `${safe} {.${b.align}}` : safe, "");
    }
    if (extra) {
      for (const e of extra) {
        const [num, text] = e.split("\uE000");
        lines.push(`[^${num}]: ${text}`, "");
      }
    }
  });
  // Page breaks next to a chapter start, or at the ends of the book, add nothing: drop them.
  let markdown = lines.join("\n").replace(/\uE000PB\uE000/g, "").replace(/\n{3,}/g, "\n\n");
  markdown = markdown
    .split("\n")
    .filter((l, i, a) => !(l === PAGE_BREAK && (/^#{1,} /.test(a[i + 2] ?? "") || i === 0)))
    .join("\n");

  const assets = f.assets.filter((a) => a.data.byteLength > 0);
  const book = importText(markdown, f.fileName);
  const langCode = f.meta.lang ? /^[a-z]{2,3}/i.exec(f.meta.lang)?.[0]?.toLowerCase() : undefined;
  const items = (["tables", "mergedCells", "textBoxes", "equations", "comments", "deletions", "insertions", "toc", "oldPictures", "unsupportedImages", "imagesNoAlt"] as ReportCode[])
    .map((code) => ({ code, count: f.counts.get(code) ?? 0 }))
    .filter((i) => i.count > 0);
  return {
    ...book,
    title: title ?? f.meta.title ?? book.title,
    author: book.author ?? author ?? f.meta.creator,
    subtitle,
    language: book.language ?? langCode,
    assets,
    markdown,
    report: { items, chapters: book.chapters.length, images: assets.length, footnotes: f.footnotes, titleStyles: f.titleStyles, words: checkWords(f.source, markdown, metaText) },
  };
}
