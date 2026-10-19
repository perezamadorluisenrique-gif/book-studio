// The book manifest: one note whose frontmatter holds the metadata and settings,
// and whose body lists the chapters as links, grouped under headings.
//
//   ---
//   book: true
//   title: The Lighthouse Keeper
//   author: Jane Doe
//   ---
//   ## Front matter
//   - [[Foreword]]
//   ## Chapters
//   ### Part One: The Sea
//   1. [[The Storm]]
//   2. [[Landfall|Chapter title override]]
//   ## Back matter
//   - [[Acknowledgments]]

import type { BookSettings, Matter } from "./model";
import { DEFAULT_SETTINGS } from "./model";
import { splitFrontmatter } from "./markdown";

export interface ManifestEntry {
  kind: "chapter";
  matter: Matter;
  target: string;
  /** Title override from the link alias. */
  title?: string;
  unnumbered: boolean;
  line: number;
}

export interface ManifestPart {
  kind: "part";
  title: string;
  line: number;
}

export interface Manifest {
  frontmatter: Record<string, unknown>;
  entries: (ManifestEntry | ManifestPart)[];
  settings: BookSettings;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return undefined;
}

/** Look up a frontmatter key in any common spelling: "isbn-print", "isbnPrint", "isbn_print", "ISBN print". */
export function fmGet(fm: Record<string, unknown>, ...keys: string[]): unknown {
  const norm = (k: string) => k.toLowerCase().replace(/[\s_-]/g, "");
  const wanted = new Set(keys.map(norm));
  for (const [k, v] of Object.entries(fm)) if (wanted.has(norm(k))) return v;
  return undefined;
}

export function fmString(fm: Record<string, unknown>, ...keys: string[]): string | undefined {
  return str(fmGet(fm, ...keys));
}

export function fmList(fm: Record<string, unknown>, ...keys: string[]): string[] {
  const v = fmGet(fm, ...keys);
  if (Array.isArray(v)) return v.map(str).filter((x): x is string => !!x);
  const s = str(v);
  if (!s) return [];
  return s.split(/\s*[;,]\s*|\s+and\s+/).filter(Boolean);
}

function fmBool(fm: Record<string, unknown>, fallback: boolean, ...keys: string[]): boolean {
  const v = fmGet(fm, ...keys);
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|yes|on|1)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0)$/i.test(v.trim())) return false;
  }
  return fallback;
}

/** True when a note's frontmatter marks it as a book manifest. */
export function isManifestFrontmatter(fm: Record<string, unknown> | undefined | null): boolean {
  if (!fm) return false;
  const book = fmGet(fm, "book", "book-studio");
  if (book === true || book === "true") return true;
  const type = fmString(fm, "type");
  return type?.toLowerCase() === "book";
}

export function settingsFromFrontmatter(fm: Record<string, unknown>, base: BookSettings = DEFAULT_SETTINGS): BookSettings {
  const start = fmString(fm, "chapter-start")?.toLowerCase();
  const heads = fmString(fm, "running-heads")?.toLowerCase();
  const size = Number(fmString(fm, "font-size"));
  return {
    theme: fmString(fm, "theme")?.toLowerCase() ?? base.theme,
    trim: fmString(fm, "trim", "trim-size")?.toLowerCase().replace(/\s|"|in/g, "").replace("×", "x") ?? base.trim,
    bleed: fmBool(fm, base.bleed, "bleed"),
    chapterStart: start === "any" || start === "recto" ? start : base.chapterStart,
    runningHeads: heads === "none" || heads === "author-title" || heads === "title-chapter" ? heads : base.runningHeads,
    toc: fmBool(fm, base.toc, "toc", "table-of-contents"),
    halfTitle: fmBool(fm, base.halfTitle, "half-title"),
    hyphenate: fmBool(fm, base.hyphenate, "hyphenate", "hyphenation"),
    fontSize: Number.isFinite(size) && size >= 7 && size <= 24 ? size : base.fontSize,
    smartTypography: fmBool(fm, base.smartTypography, "smart-quotes", "smart-typography"),
    sceneBreak: fmString(fm, "scene-break") ?? base.sceneBreak,
  };
}

const LINK = /!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]|\[([^\]]*)\]\(<?([^)>]+)>?\)/;

function sectionOf(heading: string): Matter | null {
  const h = heading.toLowerCase();
  if (/front/.test(h)) return "front";
  if (/back|end ?matter|appendi/.test(h)) return "back";
  if (/chapter|body|main|content|manuscript|story|text|cap[ií]tulos|kapitel|chapitres/.test(h)) return "body";
  return null;
}

export function parseManifest(text: string): Manifest {
  const { frontmatter, body } = splitFrontmatter(text);
  const entries: (ManifestEntry | ManifestPart)[] = [];
  let matter: Matter = "body";
  let sectionLevel = 0;
  const lines = body.split("\n");
  let inComment = false;
  lines.forEach((rawLine, idx) => {
    let line = rawLine;
    if (inComment) {
      if (line.includes("%%")) inComment = false;
      return;
    }
    if (/^\s*%%/.test(line) && !/%%.*%%/.test(line)) {
      inComment = true;
      return;
    }
    line = line.replace(/%%.*?%%/g, "");
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const sec = sectionOf(heading[2]);
      if (sec && (sectionLevel === 0 || level <= sectionLevel)) {
        matter = sec;
        sectionLevel = level;
      } else if (matter === "body" && (sectionLevel === 0 || level > sectionLevel)) {
        entries.push({ kind: "part", title: heading[2].trim(), line: idx + 1 });
      }
      return;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!item) return;
    const content = item[1];
    // ~~[[Struck]]~~ entries are drafts left out of the build.
    if (/^~~.*~~\s*$/.test(content.trim())) return;
    const m = LINK.exec(content);
    if (!m) return;
    const target = (m[1] ?? m[4] ?? "").trim();
    const alias = (m[2] ?? m[3] ?? "").trim();
    if (!target) return;
    const after = content.slice((m.index ?? 0) + m[0].length);
    const path = decodeURISafe(target);
    // Link text that only repeats the file name (as Obsidian writes Markdown links) isn't a title.
    const name = path.split("/").pop()?.replace(/\.md$/i, "");
    entries.push({
      kind: "chapter",
      matter,
      target: path,
      title: alias && alias !== target && alias !== path && alias !== name ? alias : undefined,
      unnumbered: /\b(unnumbered|no-?number)\b/i.test(after),
      line: idx + 1,
    });
  });
  return { frontmatter, entries, settings: settingsFromFrontmatter(frontmatter) };
}

function decodeURISafe(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** A starter manifest listing the given notes in order, for "Create book from folder". */
export function manifestTemplate(title: string, author: string, notes: string[], language = "en"): string {
  const esc = (s: string) => (/[:#'"]/.test(s) ? JSON.stringify(s) : s);
  const lines = [
    "---",
    "book: true",
    `title: ${esc(title)}`,
    `author: ${esc(author || "Your Name")}`,
    `language: ${language}`,
    `copyright: "© ${new Date().getFullYear()} ${author || "Your Name"}. All rights reserved."`,
    "theme: classic",
    "trim: 6x9",
    "---",
    "",
    "## Front matter",
    "",
    "## Chapters",
    "",
    ...notes.map((n, i) => `${i + 1}. [[${n}]]`),
    "",
    "## Back matter",
    "",
  ];
  return lines.join("\n");
}
