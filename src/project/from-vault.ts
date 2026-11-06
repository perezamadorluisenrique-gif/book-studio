// The other way round from to-vault.ts: read a folder of Markdown notes (a book note plus its chapters and
// images) and make book projects from it. Used to open a backup zip and to turn an Obsidian folder into a project.

import { fmString, isManifestFrontmatter, parseManifest } from "../engine/manifest";
import { splitFrontmatter } from "../engine/markdown";
import { createResolver } from "../engine/resolve";
import type { Project, ProjectAsset, ProjectChapter, SectionKind } from "./model";

/** Files to read from, whatever they came from (a zip, a folder the person picked). */
export interface ImportFiles {
  paths: string[];
  text(path: string): Promise<string>;
  bytes(path: string): Promise<Uint8Array>;
}

export interface ImportResult {
  /** One project per book note found. */
  projects: Project[];
  /** Notes listed in a book that could not be found. */
  missing: string[];
  /** Front matter lines that cannot be kept (lists of settings, nested values). */
  skipped: string[];
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** Front matter keys that are layout settings; the rest are book details. */
const SETTING_KEYS = new Set(
  ["theme", "trim", "trim-size", "paper", "paper-color", "footnotes", "note-placement", "bleed", "chapter-start", "running-heads", "toc", "table-of-contents", "half-title", "hyphenate", "hyphenation", "font-size", "smart-quotes", "smart-typography", "scene-break"].map((k) => k.replace(/[\s_-]/g, "")),
);
const isSetting = (k: string) => SETTING_KEYS.has(k.toLowerCase().replace(/[\s_-]/g, ""));
const SKIPPED_KEYS = new Set(["book", "type"]);

/** A front matter value as the plain text the project keeps, or null when it has no plain form. */
function plain(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.join(", ");
  return null;
}

/** A note's title (its first level-1 heading, if it opens the note) and the text after it. */
export function splitChapterNote(text: string): { section?: string; title?: string; body: string } {
  const { frontmatter, body } = splitFrontmatter(text);
  const section = fmString(frontmatter, "section");
  // splitFrontmatter keeps the front matter's lines blank so line numbers stay right; drop them again.
  const lines = body.replace(/^\n+/, "").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  const m = first >= 0 ? /^#\s+(.+?)\s*#*\s*$/.exec(lines[first]) : null;
  if (!m) return { section, body: body.replace(/^\n+/, "").replace(/\s+$/, "") };
  return { section, title: m[1], body: lines.slice(first + 1).join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "") };
}

function baseName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(md|markdown)$/i, "");
}

/** Every book note in the files, with its front matter, in path order. */
async function findBooks(files: ImportFiles): Promise<string[]> {
  const books: string[] = [];
  for (const path of [...files.paths].sort()) {
    if (!/\.(md|markdown)$/i.test(path)) continue;
    const text = await files.text(path);
    if (!text.startsWith("---")) continue;
    if (isManifestFrontmatter(splitFrontmatter(text).frontmatter)) books.push(path);
  }
  return books;
}

/** Make the images of the folder into project assets (the first one wins when two folders use a name). */
async function readAssets(files: ImportFiles): Promise<ProjectAsset[]> {
  const out = new Map<string, ProjectAsset>();
  for (const path of files.paths) {
    if (!IMAGE.test(path)) continue;
    const name = path.split("/").pop() ?? path;
    if (out.has(name.toLowerCase())) continue;
    out.set(name.toLowerCase(), { name, mime: MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream", data: await files.bytes(path) });
  }
  return [...out.values()];
}

export async function vaultToProjects(files: ImportFiles, opts: { now: number; newId(): string }): Promise<ImportResult> {
  const result: ImportResult = { projects: [], missing: [], skipped: [] };
  const resolve = createResolver(files.paths);
  const bookPaths = await findBooks(files);
  if (!bookPaths.length) return result;
  const assets = await readAssets(files);

  for (const bookPath of bookPaths) {
    const manifest = parseManifest(await files.text(bookPath));
    const meta: Record<string, string> = {};
    const settings: Record<string, string> = {};
    for (const [k, v] of Object.entries(manifest.frontmatter)) {
      if (SKIPPED_KEYS.has(k.toLowerCase())) continue;
      const s = plain(v);
      if (s === null) result.skipped.push(k);
      else (isSetting(k) ? settings : meta)[k] = s;
    }

    const chapters: ProjectChapter[] = [];
    const lists: Record<SectionKind, string[]> = { front: [], body: [], back: [] };
    for (const e of manifest.entries) {
      if (e.kind !== "chapter") continue;
      const path = resolve(e.target, bookPath);
      if (!path || !/\.(md|markdown)$/i.test(path)) {
        result.missing.push(e.target);
        continue;
      }
      const note = splitChapterNote(await files.text(path));
      const id = `c${chapters.length + 1}`;
      chapters.push({ id, title: note.title ?? e.title ?? baseName(path), body: note.body, ...(note.section ? { kind: note.section } : {}) });
      lists[e.matter].push(id);
    }

    const title = (meta.title ?? "").trim() || baseName(bookPath);
    meta.title = title;
    const sections = (["front", "body", "back"] as SectionKind[]).filter((k) => lists[k].length).map((kind) => ({ kind, chapterIds: lists[kind] }));
    // Only the cover is a picture the book needs by name; the rest travel along so `![[image]]` links keep working.
    result.projects.push({ id: opts.newId(), name: title, meta, settings, sections, chapters, assets, updatedAt: opts.now });
  }
  return result;
}
