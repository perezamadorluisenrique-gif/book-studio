// The book model every output (print PDF, EPUB, preview, audit) is built from.

export interface SourceRef {
  file: string;
  line: number; // 1-based
}

export interface InlineStyle {
  italic?: boolean;
  bold?: boolean;
  code?: boolean;
  smallCaps?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  href?: string;
}

export type Inline =
  | { kind: "text"; text: string; style: InlineStyle }
  | { kind: "break" }
  | { kind: "noteRef"; noteId: string };

export interface ImageRef {
  /** Vault path of the image, or "" when the link could not be resolved. */
  path: string;
  /** The link text as written, for messages. */
  target: string;
  alt: string;
  caption?: string;
  /** Marked decorative by the author (alt "decorative" or "-"): no description needed. */
  decorative: boolean;
}

export type Block =
  | { kind: "paragraph"; id: string; inlines: Inline[]; src: SourceRef }
  | { kind: "heading"; id: string; level: number; inlines: Inline[]; src: SourceRef }
  | { kind: "sceneBreak"; id: string; src: SourceRef }
  | { kind: "pageBreak"; id: string; src: SourceRef }
  | { kind: "blockquote"; id: string; blocks: Block[]; src: SourceRef }
  | { kind: "list"; id: string; ordered: boolean; start: number; items: Block[][]; src: SourceRef }
  | { kind: "code"; id: string; text: string; src: SourceRef }
  | { kind: "image"; id: string; image: ImageRef; src: SourceRef }
  | { kind: "table"; id: string; header: Inline[][]; rows: Inline[][][]; align: ("left" | "center" | "right" | null)[]; src: SourceRef };

export interface Note {
  id: string;
  /** Number shown in the text, restarting in each chapter. */
  number: number;
  blocks: Block[];
  src: SourceRef;
}

export type Matter = "front" | "body" | "back";

/** EPUB structural semantics; also drives print styling of unnumbered sections. */
export type SectionType =
  | "chapter"
  | "part"
  | "prologue"
  | "epilogue"
  | "foreword"
  | "preface"
  | "introduction"
  | "acknowledgments"
  | "afterword"
  | "appendix"
  | "glossary"
  | "bibliography"
  | "colophon"
  | "other";

export interface Chapter {
  id: string;
  matter: Matter;
  type: SectionType;
  title: Inline[];
  /** Plain-text title, for the TOC, running heads and metadata. */
  titleText: string;
  subtitle?: string;
  /** 1-based chapter number for numbered body chapters, undefined otherwise. */
  number?: number;
  /** 1-based number of a part, counted separately for box-set volumes. */
  partNumber?: number;
  /** A part page that opens one book of a box set. */
  volume?: boolean;
  blocks: Block[];
  notes: Note[];
  file?: string;
  src?: SourceRef;
}

export interface BookMeta {
  title: string;
  subtitle?: string;
  authors: string[];
  language: string;
  publisher?: string;
  isbnPrint?: string;
  isbnEbook?: string;
  description?: string;
  copyright?: string;
  edition?: string;
  year?: string;
  dedication?: string;
  epigraph?: string;
  epigraphSource?: string;
  alsoBy?: string[];
  subjects: string[];
  series?: string;
  seriesNumber?: number;
  cover?: ImageRef;
  accessibilitySummary?: string;
}

export interface ImageAsset {
  path: string;
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export interface Book {
  meta: BookMeta;
  chapters: Chapter[];
  images: Map<string, ImageAsset>;
  settings: BookSettings;
  /** Where the book came from, for messages and audit locations. */
  manifestPath: string;
  /** Notes embedded with ![[…]], so editing one rebuilds the preview. */
  embeds: Set<string>;
  warnings: BookWarning[];
}

export interface BookWarning {
  message: string;
  src?: SourceRef;
}

export type ChapterStart = "recto" | "any";
export type RunningHeads = "author-title" | "title-chapter" | "none";

export interface BookSettings {
  theme: string;
  trim: string;
  bleed: boolean;
  chapterStart: ChapterStart;
  runningHeads: RunningHeads;
  toc: boolean;
  halfTitle: boolean;
  hyphenate: boolean;
  /** Body size override in points; undefined keeps the theme's size. */
  fontSize?: number;
  smartTypography: boolean;
  sceneBreak?: string;
}

export const DEFAULT_SETTINGS: BookSettings = {
  theme: "classic",
  trim: "6x9",
  bleed: false,
  chapterStart: "recto",
  runningHeads: "author-title",
  toc: true,
  halfTitle: true,
  hyphenate: true,
  smartTypography: true,
};

/** Plain text of inline content, as used for offsets shared by print layout and EPUB page markers. */
export function inlineText(inlines: Inline[]): string {
  let out = "";
  for (const i of inlines) {
    if (i.kind === "text") out += i.text;
    else if (i.kind === "break") out += "\n";
  }
  return out;
}

/** Id of the endnotes section, shared by the print layout and the EPUB. */
export const NOTES_ID = "notes";

export function notesHeadingId(chapterId: string): string {
  return `${chapterId}-notes`;
}
