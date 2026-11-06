// Turns a project into the Markdown notes the book engine already knows how to read:
// one book note (`book: true`, front matter, links to the chapters) plus one note per chapter.
// The result is a VaultSource, the same shape as an Obsidian vault or an opened folder.

import type { VaultSource } from "../engine/book";
import { createResolver } from "../engine/resolve";
import { chapterById, type Project, type ProjectChapter, type SectionKind } from "./model";

const BAD_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** A file-name-safe version of a title ("Part 1: Start?" becomes "Part 1- Start-"). */
export function safeName(title: string, fallback: string): string {
  const s = title.replace(BAD_NAME_CHARS, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return s || fallback;
}

/** A value for a front matter line: plain when that is safe, otherwise in double quotes. */
function yamlValue(v: string): string {
  const plain = /^[\p{L}][\p{L}\p{N} .,'’()/-]*$/u.test(v) && !/^(true|false|yes|no|on|off|null|y|n)$/i.test(v) && !/\s$/.test(v);
  return plain ? v : JSON.stringify(v);
}

function yamlKey(k: string): string {
  return /^[\w-]+$/.test(k) ? k : JSON.stringify(k);
}

export interface ProjectVault extends VaultSource {
  /** The path of the generated book note. */
  bookPath: string;
  /** The title shown in the list of books. */
  bookTitle: string;
  /** Every file in the vault. */
  paths: string[];
  /** The path of each chapter's note, by chapter id. */
  chapterPaths: Record<string, string>;
}

const SECTION_HEADING: Record<SectionKind, string> = { front: "Front matter", body: "Chapters", back: "Back matter" };

export function chapterNote(c: ProjectChapter): string {
  const head = c.kind ? `---\nsection: ${yamlValue(c.kind)}\n---\n` : "";
  return `${head}# ${c.title}\n${c.body.trim() ? `\n${c.body.replace(/\s+$/, "")}\n` : ""}`;
}

/** The line (from 1) of a chapter note where its text starts, after the optional section header and the title. */
export function bodyStartLine(c: ProjectChapter): number {
  return (c.kind ? 3 : 0) + 3;
}

export function projectToVault(p: Project): ProjectVault {
  const files = new Map<string, string | Uint8Array>();
  const chapterPaths: Record<string, string> = {};
  // Notes are linked by name, so every name in the book must be different.
  const used = new Set<string>();
  const unique = (base: string): string => {
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    return name;
  };

  const title = p.meta.title?.trim() || p.name;
  const bookName = unique(safeName(title, "Book"));
  const bookPath = `${bookName}.md`;

  const lines: string[] = ["---", "book: true"];
  for (const [k, v] of Object.entries({ ...p.meta, title })) if (v.trim()) lines.push(`${yamlKey(k)}: ${yamlValue(v)}`);
  for (const [k, v] of Object.entries(p.settings)) if (v.trim()) lines.push(`${yamlKey(k)}: ${yamlValue(v)}`);
  lines.push("---", "");

  for (const section of p.sections) {
    const chapters = section.chapterIds.map((id) => chapterById(p, id)).filter((c): c is ProjectChapter => !!c);
    if (!chapters.length) continue;
    lines.push(`## ${SECTION_HEADING[section.kind]}`, "");
    chapters.forEach((c, i) => {
      const dir = section.kind === "body" ? "Chapters/" : "";
      const name = unique(safeName(c.title, "Chapter"));
      files.set(`${dir}${name}.md`, chapterNote(c));
      chapterPaths[c.id] = `${dir}${name}.md`;
      lines.push(section.kind === "body" ? `${i + 1}. [[${name}]]` : `- [[${name}]]`);
    });
    lines.push("");
  }
  files.set(bookPath, lines.join("\n"));

  for (const a of p.assets) files.set(`Images/${safeName(a.name, "image")}`, a.data);

  const paths = [...files.keys()];
  const get = (path: string) => {
    const v = files.get(path);
    if (v === undefined) throw new Error(`No such file: ${path}`);
    return v;
  };
  return {
    bookPath,
    bookTitle: title,
    paths,
    chapterPaths,
    resolve: createResolver(paths),
    read: async (path) => {
      const v = get(path);
      return typeof v === "string" ? v : new TextDecoder().decode(v);
    },
    readBinary: async (path) => {
      const v = get(path);
      return typeof v === "string" ? new TextEncoder().encode(v) : v;
    },
  };
}
