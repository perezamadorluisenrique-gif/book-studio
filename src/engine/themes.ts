// Book designs. Sizes are in points, margins in inches, spacing in body lines so
// everything stays on the baseline grid. The genre themes are Pro and live in
// themes-pro.ts, which the public repository ships empty.

import type { BookSettings } from "./model";
import { kdpMinOutside } from "./trims";
import { ornamentById, type VectorOrnament } from "./ornaments";
import { PRO_THEMES } from "./themes-pro";

export interface TextStyle {
  family: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  /** Real small caps when the family has them, synthesized otherwise. */
  smallCaps?: boolean;
  uppercase?: boolean;
  /** Letter spacing as a fraction of the size. */
  tracking?: number;
}

/** A glyph set in a font, or a drawn ornament (see ornaments.ts). */
export type Ornament = { glyph: string; family: string; size: number } | VectorOrnament;
export const isVector = (o: Ornament | undefined): o is VectorOrnament => !!o && "path" in o;

export interface Theme {
  id: string;
  name: string;
  description: string;
  pro: boolean;
  body: {
    family: string;
    size: number;
    leading: number;
    oldstyle: boolean;
    justify: boolean;
    hyphenate: boolean;
    /** First-line indent in ems; 0 with blockParagraphs. */
    indent: number;
    /** Space between paragraphs instead of indents (non-fiction style). */
    blockParagraphs: boolean;
  };
  margins: { top: number; bottom: number; outside: number; inside: number };
  chapter: {
    /** Fraction of the text block left empty above the chapter label. */
    sink: number;
    label: { show: boolean; format: "word" | "numeral" | "roman"; prefix: boolean; style: TextStyle };
    title: TextStyle & { align: "center" | "left" };
    ornament?: Ornament;
    /** Body lines left empty between the heading and the text. */
    spaceAfter: number;
  };
  part: { label: TextStyle; title: TextStyle };
  firstParagraph: { dropCap: 0 | 2 | 3; dropCapFamily?: string; leadInWords: number };
  heading2: TextStyle & { align: "center" | "left" };
  heading3: TextStyle & { align: "center" | "left" };
  sceneBreak: Ornament;
  runningHead: TextStyle;
  folio: { style: TextStyle; position: "top-outside" | "bottom-center"; onOpeners: boolean };
  blockquote: { indent: number; italic: boolean };
  titlePage: { title: TextStyle; subtitle: TextStyle; author: TextStyle; publisher: TextStyle };
  /** Colours of a typographic cover (no front image) as hex, unless the manifest sets its own. */
  cover: { background: string; ink: string };
  /** Set by resolveTheme: the body size and leading the style was designed with, before the person changed them. */
  designBody?: { size: number; leading: number };
}

const classic: Theme = {
  id: "classic",
  name: "Classic",
  description: "EB Garamond with drop caps, small-caps running heads and a fleuron for scene breaks.",
  pro: false,
  body: { family: "eb-garamond", size: 11.5, leading: 15, oldstyle: true, justify: true, hyphenate: true, indent: 1.2, blockParagraphs: false },
  margins: { top: 0.75, bottom: 0.8, outside: 0.625, inside: 0.75 },
  chapter: {
    sink: 0.22,
    label: { show: true, format: "word", prefix: true, style: { family: "eb-garamond", size: 11, smallCaps: true, uppercase: false, tracking: 0.12 } },
    title: { family: "eb-garamond", size: 20, italic: true, align: "center" },
    ornament: { glyph: "❦", family: "eb-garamond", size: 14 },
    spaceAfter: 2,
  },
  part: { label: { family: "eb-garamond", size: 12, smallCaps: true, tracking: 0.15 }, title: { family: "eb-garamond", size: 24, italic: true } },
  firstParagraph: { dropCap: 3, leadInWords: 3 },
  heading2: { family: "eb-garamond", size: 13, italic: true, align: "center" },
  heading3: { family: "eb-garamond", size: 11.5, smallCaps: true, tracking: 0.08, align: "center" },
  sceneBreak: { glyph: "❦", family: "eb-garamond", size: 13 },
  runningHead: { family: "eb-garamond", size: 9.5, smallCaps: true, tracking: 0.12 },
  folio: { style: { family: "eb-garamond", size: 10 }, position: "top-outside", onOpeners: true },
  blockquote: { indent: 1.5, italic: false },
  titlePage: {
    title: { family: "eb-garamond", size: 30 },
    subtitle: { family: "eb-garamond", size: 15, italic: true },
    author: { family: "eb-garamond", size: 14, smallCaps: true, tracking: 0.12 },
    publisher: { family: "eb-garamond", size: 10, smallCaps: true, tracking: 0.12 },
  },
  cover: { background: "#f4eee0", ink: "#2b2118" },
};

const modern: Theme = {
  id: "modern",
  name: "Modern",
  description: "Crimson Pro text with clean Montserrat headings, left-aligned chapter titles and folios at the foot.",
  pro: false,
  body: { family: "crimson-pro", size: 11.5, leading: 15.5, oldstyle: false, justify: true, hyphenate: true, indent: 1.3, blockParagraphs: false },
  margins: { top: 0.7, bottom: 0.85, outside: 0.6, inside: 0.75 },
  chapter: {
    sink: 0.18,
    label: { show: true, format: "numeral", prefix: false, style: { family: "montserrat", size: 28, bold: false } },
    title: { family: "montserrat", size: 15, bold: true, uppercase: true, tracking: 0.08, align: "left" },
    spaceAfter: 2,
  },
  part: { label: { family: "montserrat", size: 11, uppercase: true, tracking: 0.2 }, title: { family: "montserrat", size: 22, bold: true } },
  firstParagraph: { dropCap: 0, leadInWords: 4 },
  heading2: { family: "montserrat", size: 11, bold: true, align: "left" },
  heading3: { family: "montserrat", size: 9.5, bold: true, uppercase: true, tracking: 0.08, align: "left" },
  sceneBreak: { glyph: "◆ ◆ ◆", family: "montserrat", size: 6 },
  runningHead: { family: "montserrat", size: 7.5, uppercase: true, tracking: 0.18 },
  folio: { style: { family: "montserrat", size: 8.5 }, position: "bottom-center", onOpeners: true },
  blockquote: { indent: 1.5, italic: true },
  titlePage: {
    title: { family: "montserrat", size: 26, bold: true, uppercase: true, tracking: 0.06 },
    subtitle: { family: "crimson-pro", size: 15, italic: true },
    author: { family: "montserrat", size: 12, uppercase: true, tracking: 0.2 },
    publisher: { family: "montserrat", size: 8, uppercase: true, tracking: 0.2 },
  },
  cover: { background: "#12263f", ink: "#f4f6f8" },
};

const elegant: Theme = {
  id: "elegant",
  name: "Elegant",
  description: "Cormorant display type over Crimson Pro text; romantic and literary.",
  pro: false,
  body: { family: "crimson-pro", size: 11.5, leading: 15.5, oldstyle: true, justify: true, hyphenate: true, indent: 1.2, blockParagraphs: false },
  margins: { top: 0.8, bottom: 0.85, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.25,
    label: { show: true, format: "word", prefix: false, style: { family: "cormorant", size: 13, smallCaps: true, tracking: 0.2 } },
    title: { family: "cormorant", size: 26, italic: true, align: "center" },
    ornament: { glyph: "❧", family: "eb-garamond", size: 16 },
    spaceAfter: 2,
  },
  part: { label: { family: "cormorant", size: 14, smallCaps: true, tracking: 0.2 }, title: { family: "cormorant", size: 30, italic: true } },
  firstParagraph: { dropCap: 3, dropCapFamily: "cormorant", leadInWords: 0 },
  heading2: { family: "cormorant", size: 15, italic: true, align: "center" },
  heading3: { family: "cormorant", size: 12.5, smallCaps: true, tracking: 0.1, align: "center" },
  sceneBreak: { glyph: "❧", family: "eb-garamond", size: 14 },
  runningHead: { family: "cormorant", size: 10.5, italic: true },
  folio: { style: { family: "cormorant", size: 11 }, position: "bottom-center", onOpeners: false },
  blockquote: { indent: 1.5, italic: true },
  titlePage: {
    title: { family: "cormorant", size: 36, italic: true },
    subtitle: { family: "cormorant", size: 16 },
    author: { family: "cormorant", size: 15, smallCaps: true, tracking: 0.2 },
    publisher: { family: "cormorant", size: 11, smallCaps: true, tracking: 0.2 },
  },
  cover: { background: "#f3e6e1", ink: "#4a2a35" },
};

const nonfiction: Theme = {
  id: "nonfiction",
  name: "Non-fiction",
  description: "Spaced paragraphs, numbered chapters and sans-serif section headings for guides and memoirs.",
  pro: false,
  body: { family: "crimson-pro", size: 11, leading: 15, oldstyle: false, justify: true, hyphenate: true, indent: 0, blockParagraphs: true },
  margins: { top: 0.75, bottom: 0.85, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.12,
    label: { show: true, format: "numeral", prefix: true, style: { family: "montserrat", size: 10, uppercase: true, tracking: 0.18 } },
    title: { family: "montserrat", size: 20, bold: true, align: "left" },
    spaceAfter: 2,
  },
  part: { label: { family: "montserrat", size: 11, uppercase: true, tracking: 0.2 }, title: { family: "montserrat", size: 24, bold: true } },
  firstParagraph: { dropCap: 0, leadInWords: 0 },
  heading2: { family: "montserrat", size: 12.5, bold: true, align: "left" },
  heading3: { family: "montserrat", size: 10.5, bold: true, align: "left" },
  sceneBreak: { glyph: "* * *", family: "crimson-pro", size: 11 },
  runningHead: { family: "montserrat", size: 7.5, uppercase: true, tracking: 0.15 },
  folio: { style: { family: "montserrat", size: 8.5 }, position: "top-outside", onOpeners: true },
  blockquote: { indent: 1.5, italic: false },
  titlePage: {
    title: { family: "montserrat", size: 28, bold: true },
    subtitle: { family: "crimson-pro", size: 15, italic: true },
    author: { family: "montserrat", size: 12, uppercase: true, tracking: 0.15 },
    publisher: { family: "montserrat", size: 8, uppercase: true, tracking: 0.2 },
  },
  cover: { background: "#ffffff", ink: "#0b3d5c" },
};

const largePrint: Theme = {
  id: "large-print",
  name: "Large Print",
  description: "Atkinson Hyperlegible at 16 pt, ragged right and unhyphenated, following large-print guidelines.",
  pro: false,
  body: { family: "atkinson", size: 16, leading: 22, oldstyle: false, justify: false, hyphenate: false, indent: 1.2, blockParagraphs: false },
  margins: { top: 0.7, bottom: 0.8, outside: 0.6, inside: 0.75 },
  chapter: {
    sink: 0.1,
    label: { show: true, format: "numeral", prefix: true, style: { family: "atkinson", size: 16, bold: true } },
    title: { family: "atkinson", size: 22, bold: true, align: "left" },
    spaceAfter: 1,
  },
  part: { label: { family: "atkinson", size: 16, bold: true }, title: { family: "atkinson", size: 26, bold: true } },
  firstParagraph: { dropCap: 0, leadInWords: 0 },
  heading2: { family: "atkinson", size: 18, bold: true, align: "left" },
  heading3: { family: "atkinson", size: 16, bold: true, align: "left" },
  sceneBreak: { glyph: "* * *", family: "atkinson", size: 16 },
  runningHead: { family: "atkinson", size: 12 },
  folio: { style: { family: "atkinson", size: 14, bold: true }, position: "bottom-center", onOpeners: true },
  blockquote: { indent: 1.2, italic: false },
  titlePage: {
    title: { family: "atkinson", size: 32, bold: true },
    subtitle: { family: "atkinson", size: 18 },
    author: { family: "atkinson", size: 18 },
    publisher: { family: "atkinson", size: 12 },
  },
  cover: { background: "#ffffff", ink: "#000000" },
};

const literary: Theme = {
  id: "literary",
  name: "Literary",
  description: "EB Garamond text under Cormorant chapter titles, Roman numerals and a rule-and-diamond ornament; a quiet novel.",
  pro: false,
  body: { family: "eb-garamond", size: 11.5, leading: 15, oldstyle: true, justify: true, hyphenate: true, indent: 1.1, blockParagraphs: false },
  margins: { top: 0.85, bottom: 0.9, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.24,
    label: { show: true, format: "roman", prefix: false, style: { family: "eb-garamond", size: 12, smallCaps: true, tracking: 0.2 } },
    title: { family: "cormorant", size: 26, italic: true, align: "center" },
    ornament: { path: ornamentById("diamond-rule", 60)!.path, width: 60 },
    spaceAfter: 2,
  },
  part: { label: { family: "eb-garamond", size: 12, smallCaps: true, tracking: 0.2 }, title: { family: "cormorant", size: 30, italic: true } },
  firstParagraph: { dropCap: 2, dropCapFamily: "eb-garamond", leadInWords: 0 },
  heading2: { family: "cormorant", size: 15, italic: true, align: "center" },
  heading3: { family: "eb-garamond", size: 11.5, smallCaps: true, tracking: 0.1, align: "center" },
  sceneBreak: { path: ornamentById("leaves", 44)!.path, width: 44 },
  runningHead: { family: "eb-garamond", size: 9.5, italic: true },
  folio: { style: { family: "eb-garamond", size: 10 }, position: "bottom-center", onOpeners: false },
  blockquote: { indent: 1.5, italic: true },
  titlePage: {
    title: { family: "cormorant", size: 34, italic: true },
    subtitle: { family: "eb-garamond", size: 15, italic: true },
    author: { family: "eb-garamond", size: 14, smallCaps: true, tracking: 0.18 },
    publisher: { family: "eb-garamond", size: 10, smallCaps: true, tracking: 0.15 },
  },
  cover: { background: "#f6f1e7", ink: "#22303c" },
};

const minimal: Theme = {
  id: "minimal",
  name: "Minimal",
  description: "Crimson Pro throughout, no chapter label, titles flush left and a short rule between scenes; airy margins.",
  pro: false,
  body: { family: "crimson-pro", size: 11, leading: 15.5, oldstyle: false, justify: true, hyphenate: true, indent: 1, blockParagraphs: false },
  margins: { top: 0.8, bottom: 0.85, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.1,
    label: { show: false, format: "numeral", prefix: false, style: { family: "crimson-pro", size: 11 } },
    title: { family: "crimson-pro", size: 19, bold: true, align: "left" },
    spaceAfter: 3,
  },
  part: { label: { family: "crimson-pro", size: 11, uppercase: true, tracking: 0.2 }, title: { family: "crimson-pro", size: 22, bold: true } },
  firstParagraph: { dropCap: 0, leadInWords: 0 },
  heading2: { family: "crimson-pro", size: 12.5, bold: true, align: "left" },
  heading3: { family: "crimson-pro", size: 11.5, italic: true, align: "left" },
  sceneBreak: { path: ornamentById("rule", 40)!.path, width: 40 },
  runningHead: { family: "crimson-pro", size: 8.5, italic: true },
  folio: { style: { family: "crimson-pro", size: 9 }, position: "top-outside", onOpeners: true },
  blockquote: { indent: 1.5, italic: false },
  titlePage: {
    title: { family: "crimson-pro", size: 28, bold: true },
    subtitle: { family: "crimson-pro", size: 15, italic: true },
    author: { family: "crimson-pro", size: 13 },
    publisher: { family: "crimson-pro", size: 10 },
  },
  cover: { background: "#ffffff", ink: "#1b1b1b" },
};

const memoir: Theme = {
  id: "memoir",
  name: "Memoir",
  description: "Crimson Pro text with EB Garamond headings, spelled-out chapter labels, a small-caps lead-in and three dots between scenes.",
  pro: false,
  body: { family: "crimson-pro", size: 11, leading: 14, oldstyle: true, justify: true, hyphenate: true, indent: 1.2, blockParagraphs: false },
  margins: { top: 0.75, bottom: 0.85, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.16,
    label: { show: true, format: "word", prefix: true, style: { family: "eb-garamond", size: 11, smallCaps: true, tracking: 0.14 } },
    title: { family: "eb-garamond", size: 22, align: "left" },
    spaceAfter: 2,
  },
  part: { label: { family: "eb-garamond", size: 12, smallCaps: true, tracking: 0.15 }, title: { family: "eb-garamond", size: 26 } },
  firstParagraph: { dropCap: 0, leadInWords: 5 },
  heading2: { family: "eb-garamond", size: 14, italic: true, align: "left" },
  heading3: { family: "eb-garamond", size: 11.5, smallCaps: true, tracking: 0.08, align: "left" },
  sceneBreak: { path: ornamentById("dots", 28)!.path, width: 28 },
  runningHead: { family: "eb-garamond", size: 9.5, italic: true },
  folio: { style: { family: "eb-garamond", size: 10 }, position: "top-outside", onOpeners: false },
  blockquote: { indent: 1.5, italic: true },
  titlePage: {
    title: { family: "eb-garamond", size: 30 },
    subtitle: { family: "eb-garamond", size: 15, italic: true },
    author: { family: "eb-garamond", size: 14, smallCaps: true, tracking: 0.12 },
    publisher: { family: "eb-garamond", size: 10, smallCaps: true, tracking: 0.12 },
  },
  cover: { background: "#efe7da", ink: "#3b2a20" },
};

const textbook: Theme = {
  id: "textbook",
  name: "Textbook",
  description: "EB Garamond text in spaced paragraphs with Montserrat headings, Roman chapter numbers and a lozenge row between sections.",
  pro: false,
  body: { family: "eb-garamond", size: 10.75, leading: 14.5, oldstyle: false, justify: true, hyphenate: true, indent: 0, blockParagraphs: true },
  margins: { top: 0.75, bottom: 0.9, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.12,
    label: { show: true, format: "roman", prefix: true, style: { family: "montserrat", size: 9.5, uppercase: true, tracking: 0.2 } },
    title: { family: "montserrat", size: 19, bold: true, align: "left" },
    ornament: { path: ornamentById("rule", 36)!.path, width: 36 },
    spaceAfter: 2,
  },
  part: { label: { family: "montserrat", size: 10, uppercase: true, tracking: 0.2 }, title: { family: "montserrat", size: 24, bold: true } },
  firstParagraph: { dropCap: 0, leadInWords: 0 },
  heading2: { family: "montserrat", size: 12, bold: true, align: "left" },
  heading3: { family: "montserrat", size: 10, bold: true, italic: true, align: "left" },
  sceneBreak: { path: ornamentById("lozenges", 40)!.path, width: 40 },
  runningHead: { family: "montserrat", size: 7.5, uppercase: true, tracking: 0.15 },
  folio: { style: { family: "montserrat", size: 8.5 }, position: "bottom-center", onOpeners: true },
  blockquote: { indent: 1.5, italic: false },
  titlePage: {
    title: { family: "montserrat", size: 26, bold: true },
    subtitle: { family: "eb-garamond", size: 15, italic: true },
    author: { family: "montserrat", size: 12, uppercase: true, tracking: 0.15 },
    publisher: { family: "montserrat", size: 8, uppercase: true, tracking: 0.2 },
  },
  cover: { background: "#ffffff", ink: "#16405a" },
};

export const THEMES: Theme[] = [classic, modern, elegant, nonfiction, largePrint, literary, minimal, memoir, textbook, ...PRO_THEMES];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? classic;
}

/** Limits of the body size in points; Large Print has its own. */
export function sizeRange(themeId: string): { min: number; max: number } {
  return themeId === "large-print" ? { min: 16, max: 20 } : { min: 9, max: 14 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The one place a book's style is decided: the style picked by id, then the person's changes (settings.style),
 * then the two older settings (fontSize, sceneBreak) which are still read. Limits live here, not on the screen.
 * Without any change the result is the style as designed.
 */
export function resolveTheme(settings: Pick<BookSettings, "theme" | "fontSize" | "sceneBreak" | "style" | "bleed">): Theme {
  const base = themeById(settings.theme);
  const st = settings.style;
  const range = sizeRange(base.id);
  const designSize = base.body.size;
  const wantedSize = finite(st?.size) ? clamp(st.size, range.min, range.max) : settings.fontSize;
  const size = finite(wantedSize) ? wantedSize : designSize;
  // Leading keeps the style's proportion unless the person sets one; then it is a multiple of the size on a 0.25 pt grid.
  const leading = finite(st?.leading) ? Math.round((size * clamp(st.leading, 1.2, 1.5)) / 0.25) * 0.25 : (base.body.leading * size) / designSize;
  const minOut = kdpMinOutside(!!settings.bleed);
  const m = st?.margins;
  const margin = (side: "top" | "bottom" | "outside" | "inside") => {
    const v = m?.[side];
    return finite(v) ? Math.max(minOut, clamp(v, 0, 2)) : base.margins[side];
  };
  const dropCap = st?.dropCap === 0 || st?.dropCap === 2 || st?.dropCap === 3 ? st.dropCap : base.firstParagraph.dropCap;
  const wanted = st?.sceneBreak ?? settings.sceneBreak;
  const picked = wanted?.startsWith("ornament:") ? ornamentById(wanted.slice(9), 48) : undefined;
  const glyphBase = isVector(base.sceneBreak) ? { family: base.body.family, size: 13 } : base.sceneBreak;
  const sceneBreak: Ornament = picked ?? (wanted && !wanted.startsWith("ornament:") ? { glyph: wanted, family: glyphBase.family, size: glyphBase.size } : base.sceneBreak);
  return {
    ...base,
    body: { ...base.body, size, leading, indent: finite(st?.indent) ? clamp(st.indent, 0, 3) : base.body.indent },
    margins: { top: margin("top"), bottom: margin("bottom"), outside: margin("outside"), inside: margin("inside") },
    firstParagraph: { ...base.firstParagraph, dropCap },
    sceneBreak,
    designBody: { size: designSize, leading: base.body.leading },
  };
}
