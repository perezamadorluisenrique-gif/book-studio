// Load a book: read the manifest, parse every listed note, number chapters,
// gather footnotes and images. Hosts supply file access through VaultSource.

import type { Block, Book, BookMeta, BookSettings, BookWarning, Chapter, ImageAsset, ImageRef, Inline, Note, SectionType } from "./model";
import { inlineText } from "./model";
import { fmGet, fmList, fmString, isManifestFrontmatter, parseManifest, type Manifest, type ManifestEntry } from "./manifest";
import { parseMarkdown, parseNoteText, splitFrontmatter, type NoteDef, type ParseContext } from "./markdown";
import { imageInfo } from "./images";
import { smartenText } from "./typography";
import { stripPartPrefix } from "./i18n";

export interface VaultSource {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  /** Resolve a link target written in note `from` to a vault path. */
  resolve(target: string, from: string): string | null;
}

const SECTION_TYPES: [RegExp, SectionType][] = [
  [/^(prologue|pr[oó]logo|prolog)$/i, "prologue"],
  [/^(epilogue|ep[ií]logo|epilog)$/i, "epilogue"],
  [/^(foreword|vorwort|pr[ée]face de)/i, "foreword"],
  [/^(preface|prefacio|pr[ée]face)$/i, "preface"],
  [/^(introduction|introducci[oó]n|einleitung)$/i, "introduction"],
  [/^(acknowledge?ments|agradecimientos|danksagung|remerciements)$/i, "acknowledgments"],
  [/^(afterword|nachwort|postfacio)$/i, "afterword"],
  [/^(appendix|ap[eé]ndice|anhang|annexe)\b/i, "appendix"],
  [/^(glossary|glosario|glossar)$/i, "glossary"],
  [/^(bibliography|references|bibliograf[ií]a|literatur)$/i, "bibliography"],
  [/^colophon$/i, "colophon"],
];

function sectionTypeFor(title: string): SectionType | null {
  const t = title.trim();
  for (const [re, type] of SECTION_TYPES) if (re.test(t)) return type;
  return null;
}

function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** "03 - The Storm" → "The Storm"; "Chapter 3" stays. */
export function titleFromFilename(path: string): string {
  const b = basename(path).replace(/^\d+[\s._-]*(?=\S)/, "");
  return b || basename(path);
}

function collectImages(blocks: Block[], out: ImageRef[]): void {
  for (const b of blocks) {
    if (b.kind === "image") out.push(b.image);
    else if (b.kind === "blockquote") collectImages(b.blocks, out);
    else if (b.kind === "list") b.items.forEach((it) => collectImages(it, out));
  }
}

function walkInlines(blocks: Block[], fn: (inlines: Inline[]) => Inline[]): void {
  for (const b of blocks) {
    if (b.kind === "paragraph" || b.kind === "heading") b.inlines = fn(b.inlines);
    else if (b.kind === "blockquote") walkInlines(b.blocks, fn);
    else if (b.kind === "list") b.items.forEach((it) => walkInlines(it, fn));
    else if (b.kind === "table") {
      b.header = b.header.map(fn);
      b.rows = b.rows.map((r) => r.map(fn));
    }
  }
}

function editionsOf(v: unknown): Record<string, Record<string, unknown>> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, body] of Object.entries(v as Record<string, unknown>)) if (body && typeof body === "object" && !Array.isArray(body)) out[id] = body as Record<string, unknown>;
  return out;
}

export interface LoadOptions {
  /** Metadata an edition changes: its own ISBN and edition line. */
  meta?: Partial<Pick<BookMeta, "isbnPrint" | "isbnEbook" | "edition">>;
  /** Read notes that are book manifests themselves as box-set volumes (Pro). */
  boxSets?: boolean;
}

export async function loadBook(source: VaultSource, manifestPath: string, overrides: Partial<BookSettings> = {}, opts: LoadOptions = {}): Promise<Book> {
  const manifestText = await source.read(manifestPath);
  const manifest = parseManifest(manifestText);
  const fm = manifest.frontmatter;
  const settings: BookSettings = { ...manifest.settings, ...stripUndefined(overrides) };
  const warnings: BookWarning[] = [];
  const language = fmString(fm, "language", "lang") ?? "en";
  const smart = (s: string | undefined) => (s && settings.smartTypography ? smartenText(s, language) : s);

  const authors = fmList(fm, "author", "authors");
  const year = fmString(fm, "year", "date")?.slice(0, 4) ?? String(new Date().getFullYear());
  const meta: BookMeta = {
    title: smart(fmString(fm, "title")) ?? basename(manifestPath),
    subtitle: smart(fmString(fm, "subtitle")),
    authors,
    language,
    publisher: fmString(fm, "publisher", "imprint"),
    isbnPrint: fmString(fm, "isbn", "isbn-print", "paperback-isbn", "print-isbn"),
    isbnEbook: fmString(fm, "ebook-isbn", "isbn-ebook", "epub-isbn"),
    description: smart(fmString(fm, "description", "blurb")),
    copyright: smart(fmString(fm, "copyright")) ?? `Copyright © ${year} ${authors.join(" and ") || "the author"}. All rights reserved.`,
    edition: fmString(fm, "edition"),
    year,
    dedication: smart(fmString(fm, "dedication")),
    epigraph: smart(fmString(fm, "epigraph")),
    epigraphSource: smart(fmString(fm, "epigraph-source", "epigraph-author")),
    alsoBy: fmList(fm, "also-by").map((s) => smart(s) ?? s),
    subjects: fmList(fm, "subjects", "keywords", "genre"),
    series: fmString(fm, "series"),
    seriesNumber: Number(fmString(fm, "series-number", "series-index")) || undefined,
    accessibilitySummary: fmString(fm, "accessibility-summary"),
    editions: editionsOf(fmGet(fm, "editions")),
    indexTerms: fmList(fm, "index-terms", "index").map((t) => t.trim()).filter(Boolean),
    coverDesign: { blurb: [], bio: [] },
  };
  if (!authors.length) warnings.push({ message: "No author in the manifest frontmatter (author: Your Name).", src: { file: manifestPath, line: 1 } });

  const coverTarget = fmGet(fm, "cover", "cover-image");
  if (typeof coverTarget === "string" && coverTarget.trim()) {
    const target = coverTarget.replace(/^!?\[\[|\]\]$/g, "").split("|")[0].trim();
    const path = source.resolve(target, manifestPath) ?? "";
    if (!path) warnings.push({ message: `Cover image not found: ${target}`, src: { file: manifestPath, line: 1 } });
    meta.cover = { path, target, alt: `Cover of ${meta.title}`, decorative: false };
  }

  const design = meta.coverDesign;
  design.tagline = smart(fmString(fm, "tagline", "cover-tagline"));
  design.spineTitle = fmString(fm, "spine-title", "spine-text");
  design.background = hexColor(fmString(fm, "cover-background", "cover-color"));
  design.ink = hexColor(fmString(fm, "cover-ink", "cover-text-color"));
  design.blurb = (await paragraphsOf(source, manifestPath, fmGet(fm, "back-blurb", "back-cover", "back-cover-text") ?? fmGet(fm, "description", "blurb"))).map((p) => smart(p) ?? p);
  design.bio = (await paragraphsOf(source, manifestPath, fmGet(fm, "author-bio", "about-the-author-short"))).map((p) => smart(p) ?? p);
  const photoTarget = fmGet(fm, "author-photo");
  if (typeof photoTarget === "string" && photoTarget.trim()) {
    const target = photoTarget.replace(/^!?\[\[|\]\]$/g, "").split("|")[0].trim();
    const path = source.resolve(target, manifestPath) ?? "";
    if (!path) warnings.push({ message: `Author photo not found: ${target}`, src: { file: manifestPath, line: 1 } });
    design.photo = { path, target, alt: `Photo of ${authors[0] ?? "the author"}`, decorative: false };
  }

  let blockCounter = 0;
  const embeds = new Set<string>();
  const ctxFor = (file: string): ParseContext => ({
    file,
    lang: language,
    smart: settings.smartTypography,
    nextId: () => `b${++blockCounter}`,
    resolve: (t, from) => source.resolve(t, from),
    readNote: (p) => {
      embeds.add(p);
      return source.read(p);
    },
    warnings,
  });

  const chapters: Chapter[] = [];
  let chapterNumber = 0;
  let partNumber = 0;
  let volumeNumber = 0;

  const addPart = (title: string, line: number, file: string, volume = false, subtitle?: string) => {
    chapters.push({
      id: `ch${chapters.length + 1}`,
      matter: "body",
      type: "part",
      title: [{ kind: "text", text: title, style: {} }],
      titleText: title,
      subtitle,
      partNumber: volume ? ++volumeNumber : ++partNumber,
      volume: volume || undefined,
      blocks: [],
      notes: [],
      src: { file, line },
    });
  };

  // `inVolume` is the manifest of the box-set volume being read: its chapters
  // all go in the body, its own parts are dropped, and numbering restarts.
  const addEntries = async (entries: Manifest["entries"], from: string, inVolume: boolean): Promise<void> => {
    for (const entry of entries) {
      if (entry.kind === "part") {
        if (inVolume) continue;
        const written = stripPartPrefix(entry.title);
        addPart(smart(written) ?? written, entry.line, from);
        continue;
      }
      const path = source.resolve(entry.target, from);
      if (!path) {
        warnings.push({ message: `Chapter note not found: ${entry.target}`, src: { file: from, line: entry.line } });
        continue;
      }
      const text = await source.read(path);
      const sub = splitFrontmatter(text).frontmatter;
      if (isManifestFrontmatter(sub)) {
        if (inVolume || !opts.boxSets) {
          warnings.push({
            message: inVolume ? `A box-set volume can't contain another book: ${entry.target}` : `${entry.target} is a book of its own. Box sets are part of Book Studio Pro; it was left out.`,
            src: { file: from, line: entry.line },
          });
          continue;
        }
        const volume = parseManifest(text);
        const t = entry.title ?? fmString(volume.frontmatter, "title") ?? titleFromFilename(path);
        addPart(smart(t) ?? t, entry.line, from, true, smart(fmString(volume.frontmatter, "subtitle")));
        const outer = chapterNumber;
        chapterNumber = 0;
        await addEntries(volume.entries, path, true);
        chapterNumber = outer;
        continue;
      }
      await addChapter(entry, path, text, inVolume);
    }
  };

  const addChapter = async (entry: ManifestEntry, path: string, text: string, inVolume: boolean): Promise<void> => {
    const ctx = ctxFor(path);
    const parsed = await parseMarkdown(text, ctx);
    let blocks = parsed.blocks;
    let title: Inline[] | undefined;
    const first = blocks[0];
    if (first?.kind === "heading" && first.level === 1) {
      title = first.inlines;
      blocks = blocks.slice(1);
    }
    if (entry.title) title = [{ kind: "text", text: smart(entry.title) ?? entry.title, style: {} }];
    if (!title) {
      const t = fmString(parsed.frontmatter, "title") ?? titleFromFilename(path);
      title = [{ kind: "text", text: smart(t) ?? t, style: {} }];
    }
    const titleText = inlineText(title).trim();
    const explicitType = fmString(parsed.frontmatter, "section", "epub-type") as SectionType | undefined;
    const type: SectionType = explicitType ?? sectionTypeFor(titleText) ?? (entry.matter === "body" ? "chapter" : "other");
    const numberedFm = fmGet(parsed.frontmatter, "numbered");
    const numbered = entry.matter === "body" && type === "chapter" && !entry.unnumbered && numberedFm !== false && numberedFm !== "false";
    const chapter: Chapter = {
      id: `ch${chapters.length + 1}`,
      matter: inVolume ? "body" : entry.matter,
      type,
      title,
      titleText,
      subtitle: smart(fmString(parsed.frontmatter, "subtitle")),
      number: numbered ? ++chapterNumber : undefined,
      blocks,
      notes: [],
      file: path,
      src: { file: path, line: 1 },
    };
    await attachNotes(chapter, parsed.noteDefs, ctx);
    chapters.push(chapter);
  };

  await addEntries(manifest.entries, manifestPath, false);
  if (!chapters.some((c) => c.type !== "part")) {
    warnings.push({ message: "The manifest lists no chapters. Add links like 1. [[Chapter One]] under a ## Chapters heading.", src: { file: manifestPath, line: 1 } });
  }

  const refs: ImageRef[] = [];
  for (const c of chapters) {
    collectImages(c.blocks, refs);
    c.notes.forEach((n) => collectImages(n.blocks, refs));
  }
  if (meta.cover) refs.push(meta.cover);
  if (design.photo) refs.push(design.photo);
  const images = new Map<string, ImageAsset>();
  for (const ref of refs) {
    if (!ref.path || images.has(ref.path)) continue;
    try {
      const bytes = await source.readBinary(ref.path);
      const info = imageInfo(ref.path, bytes);
      if (info) images.set(ref.path, info);
      else warnings.push({ message: `Only PNG and JPEG images can be printed: ${ref.target}` });
    } catch {
      warnings.push({ message: `Could not read image ${ref.target}` });
    }
  }

  return { meta: { ...meta, ...stripUndefined(opts.meta ?? {}) }, chapters, images, settings, manifestPath, embeds, warnings };
}

async function attachNotes(chapter: Chapter, defs: Map<string, NoteDef>, ctx: ParseContext): Promise<void> {
  const order: string[] = [];
  walkInlines(chapter.blocks, (inlines) => {
    for (const i of inlines) if (i.kind === "noteRef" && !order.includes(i.noteId)) order.push(i.noteId);
    return inlines;
  });
  const renamed = new Map<string, string>();
  const notes: Note[] = [];
  for (const raw of order) {
    const def = defs.get(raw);
    if (!def) {
      ctx.warnings.push({ message: `Footnote [^${raw}] has no definition.`, src: chapter.src });
      continue;
    }
    const number = notes.length + 1;
    const id = `${chapter.id}-n${number}`;
    renamed.set(raw, id);
    // A note from an embedded note resolves its links and images from that note.
    const file = def.file ?? ctx.file;
    notes.push({ id, number, blocks: await parseNoteText(def.text, { ...ctx, file }, def.line), src: { file, line: def.line } });
  }
  walkInlines(chapter.blocks, (inlines) =>
    inlines.flatMap<Inline>((i) => {
      if (i.kind !== "noteRef") return [i];
      const id = renamed.get(i.noteId);
      return id ? [{ ...i, noteId: id }] : [];
    }),
  );
  chapter.notes = notes;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** "#abc" or "#aabbcc" in lower case, or undefined for anything else. */
export function hexColor(v: string | undefined): string | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((v ?? "").trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

/**
 * Paragraphs of plain text from a frontmatter value: a list of paragraphs, a
 * string with blank lines between them, or a link to a note whose text is used.
 */
async function paragraphsOf(source: VaultSource, from: string, v: unknown): Promise<string[]> {
  let text = "";
  if (Array.isArray(v)) text = v.map((x) => String(x)).join("\n\n");
  else if (typeof v === "string") text = v;
  else return [];
  const link = /^\s*!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(text);
  if (link) {
    const path = source.resolve(link[1].trim(), from);
    if (!path) return [];
    text = splitFrontmatter(await source.read(path)).body;
  }
  return text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/^#+\s+.*$/gm, "")
        .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|~~|`)/g, "")
        .replace(/^>\s?/gm, "")
        .replace(/\s*\n\s*/g, " ")
        .trim(),
    )
    .filter(Boolean);
}
