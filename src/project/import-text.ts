// Turns a Markdown or plain-text manuscript into book chapters (C1 of the app plan).
// Pure code: text in, a list of chapters out. The screen only reads the file and calls this.
//
// Where a new chapter starts, in this order of preference:
//   1. lines that begin with "# " (a heading of level 1);
//   2. when there is a single "# " (the book's title) and several "## ", the "## " lines;
//   3. lines such as "Chapter 3", "Capítulo 3", "CHAPTER IV" or "Capítulo uno: El viaje".
// Text with none of these becomes one chapter.

import type { Project, ProjectAsset, ProjectChapter, ProjectSection, SectionKind } from "./model";

export interface ImportedBook {
  /** The book's title when the text gives one (front matter or a lone "# " heading). */
  title?: string;
  author?: string;
  language?: string;
  chapters: ProjectChapter[];
  sections: ProjectSection[];
  /** Short facts for the person: what was found and what was left out. */
  notes: string[];
}

const NUMBER_WORDS =
  "uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|primero|primer|segundo|tercero|tercer|cuarto|quinto|" +
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|first|second|third|fourth|fifth";
/** "Chapter 3", "CAPÍTULO IV", "Capítulo uno: The trip" (the whole line is the title). */
const CHAPTER_LINE = new RegExp(`^\\s*(cap[ií]tulo|chapter)\\s+(\\d{1,3}|[ivxlcdm]{1,7}|${NUMBER_WORDS})\\b[\\s.:\\-–—]*(.*)$`, "i");

const FRONT: [RegExp, string | undefined][] = [
  [/^(dedication|dedicatoria)$/i, "dedication"],
  [/^(foreword|prefacio|preface|pr[ée]face|vorwort)$/i, undefined],
];
const BACK: [RegExp, string | undefined][] = [
  [/^(about the author|acerca del autor|sobre el autor|sobre la autora|acerca de la autora)$/i, "about-the-author"],
  [/^(acknowledge?ments|agradecimientos|afterword|postfacio|appendix|ap[eé]ndice|glossary|glosario|bibliography|bibliograf[ií]a|references|colophon)\b/i, undefined],
];

function classify(title: string): { kind: SectionKind; section?: string } {
  const t = title.trim();
  for (const [re, section] of FRONT) if (re.test(t)) return { kind: "front", section };
  for (const [re, section] of BACK) if (re.test(t)) return { kind: "back", section };
  return { kind: "body" };
}

/** Read a "---" block at the very start: simple `key: value` lines only. */
function frontMatter(text: string): { meta: Record<string, string>; rest: string } {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { meta: {}, rest: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([\w-]+):[ \t]*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, rest: text.slice(m[0].length) };
}

interface Cut {
  line: number;
  title: string;
}

/** Line numbers that are inside a fenced code block (``` or ~~~), so a "# comment" there is not a heading. */
function fenced(lines: string[]): boolean[] {
  const inside = new Array<boolean>(lines.length).fill(false);
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      inside[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1];
      inside[i] = true;
    }
  });
  return inside;
}

function headings(lines: string[], inside: boolean[], level: number): Cut[] {
  const re = new RegExp(`^#{${level}}[ \\t]+(.+?)[ \\t#]*$`);
  const cuts: Cut[] = [];
  lines.forEach((l, i) => {
    if (inside[i]) return;
    const m = re.exec(l);
    if (m) cuts.push({ line: i, title: m[1].trim() });
  });
  return cuts;
}

function chapterLines(lines: string[], inside: boolean[]): Cut[] {
  const cuts: Cut[] = [];
  lines.forEach((l, i) => {
    if (inside[i]) return;
    // Only a short line on its own: a sentence that merely starts with "Chapter 3 shows…" stays text.
    if (l.length > 80 || (i > 0 && lines[i - 1].trim() !== "")) return;
    const m = CHAPTER_LINE.exec(l);
    if (!m) return;
    const rest = m[3].trim();
    if (rest.length > 0 && /[.!?]$/.test(rest) && rest.split(/\s+/).length > 8) return;
    cuts.push({ line: i, title: l.trim().replace(/[\s.:\-–—]+$/, "") });
  });
  return cuts;
}

const tidy = (s: string): string => s.replace(/^\n+/, "").replace(/\s+$/, "");

/** Split a manuscript into chapters. `fileName` (without folder) names the book when the text has no title. */
export function importText(raw: string, fileName = ""): ImportedBook {
  const notes: string[] = [];
  const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n?/g, "\n");
  const { meta, rest } = frontMatter(text);
  const lines = rest.split("\n");
  const inside = fenced(lines);

  let title: string | undefined = meta.title;
  let skip = new Set<number>();
  let cuts = headings(lines, inside, 1);
  if (cuts.length === 1) {
    const h2 = headings(lines, inside, 2);
    if (h2.length >= 2) {
      title ??= cuts[0].title;
      skip = new Set([cuts[0].line]);
      cuts = h2;
      notes.push("title-heading");
    }
  }
  let how = "heading";
  if (!cuts.length) {
    cuts = chapterLines(lines, inside);
    how = "pattern";
  }
  if (!cuts.length) how = "none";

  const chapters: ProjectChapter[] = [];
  const sections: Record<SectionKind, string[]> = { front: [], body: [], back: [] };
  const add = (name: string, body: string): void => {
    const id = `c${chapters.length + 1}`;
    const c = classify(name);
    const chapter: ProjectChapter = { id, title: name || "Untitled", body: tidy(body) };
    if (c.section) chapter.kind = c.section;
    chapters.push(chapter);
    sections[c.kind].push(id);
  };
  const slice = (from: number, to: number): string =>
    lines
      .slice(from, to)
      .filter((_, i) => !skip.has(from + i))
      .join("\n");

  if (how === "none") {
    const name = meta.title ?? (fileName.replace(/\.[^.]+$/, "").trim() || "Untitled");
    add(name, lines.filter((_, i) => !skip.has(i)).join("\n"));
    title ??= fileName.replace(/\.[^.]+$/, "").trim() || undefined;
  } else {
    const first = cuts[0].line;
    const intro = tidy(slice(0, first));
    if (intro) {
      add("Untitled", intro);
      notes.push("intro");
    }
    cuts.forEach((cut, i) => {
      const end = i + 1 < cuts.length ? cuts[i + 1].line : lines.length;
      add(cut.title, slice(cut.line + 1, end));
    });
  }

  const order: SectionKind[] = ["front", "body", "back"];
  const out: ProjectSection[] = order.filter((k) => sections[k].length).map((k) => ({ kind: k, chapterIds: sections[k] }));
  if (how !== "none") notes.unshift(how);
  return { title, author: meta.author ?? meta.authors, language: meta.language ?? meta.lang, chapters, sections: out, notes };
}

export interface ImportOptions {
  id: string;
  now: number;
  /** The book's name; defaults to the text's title. */
  name?: string;
  fileName?: string;
  /** The language used when the text does not say one. */
  language?: string;
}

/** A new project made from chapters that were already split (also used by the Word import). */
export function projectFromImport(imported: ImportedBook & { assets?: ProjectAsset[] }, o: ImportOptions): Project {
  const name = o.name?.trim() || imported.title || "Untitled";
  return {
    id: o.id,
    name,
    meta: { title: name, author: imported.author ?? "", language: imported.language ?? o.language ?? "en" },
    settings: { theme: "classic", trim: "6x9" },
    sections: imported.sections,
    chapters: imported.chapters,
    assets: imported.assets ?? [],
    updatedAt: o.now,
  };
}

/** A new project made from an imported manuscript. */
export function projectFromText(raw: string, o: ImportOptions): { project: Project; imported: ImportedBook } {
  const imported = importText(raw, o.fileName);
  return { project: projectFromImport(imported, o), imported };
}
