// Book designs. Sizes are in points, margins in inches, spacing in body lines so
// everything stays on the baseline grid.

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
    ornament?: { glyph: string; family: string; size: number };
    /** Body lines left empty between the heading and the text. */
    spaceAfter: number;
  };
  part: { label: TextStyle; title: TextStyle };
  firstParagraph: { dropCap: 0 | 2 | 3; dropCapFamily?: string; leadInWords: number };
  heading2: TextStyle & { align: "center" | "left" };
  heading3: TextStyle & { align: "center" | "left" };
  sceneBreak: { glyph: string; family: string; size: number };
  runningHead: TextStyle;
  folio: { style: TextStyle; position: "top-outside" | "bottom-center"; onOpeners: boolean };
  blockquote: { indent: number; italic: boolean };
  titlePage: { title: TextStyle; subtitle: TextStyle; author: TextStyle; publisher: TextStyle };
  /** Colours of a typographic cover (no front image) as hex, unless the manifest sets its own. */
  cover: { background: string; ink: string };
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
  pro: true,
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
  pro: true,
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
  pro: true,
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

const thriller: Theme = {
  id: "thriller",
  name: "Thriller",
  description: "Crimson Pro text under bold Montserrat chapter numbers, short chapter openers and plenty of white space.",
  pro: true,
  body: { family: "crimson-pro", size: 11, leading: 14.5, oldstyle: false, justify: true, hyphenate: true, indent: 1.1, blockParagraphs: false },
  margins: { top: 0.75, bottom: 0.85, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.1,
    label: { show: true, format: "numeral", prefix: false, style: { family: "montserrat", size: 44, bold: true } },
    title: { family: "montserrat", size: 11, uppercase: true, tracking: 0.3, align: "left" },
    spaceAfter: 3,
  },
  part: { label: { family: "montserrat", size: 11, uppercase: true, tracking: 0.3 }, title: { family: "montserrat", size: 30, bold: true, uppercase: true } },
  firstParagraph: { dropCap: 0, leadInWords: 3 },
  heading2: { family: "montserrat", size: 11, bold: true, uppercase: true, tracking: 0.12, align: "left" },
  heading3: { family: "montserrat", size: 9, bold: true, uppercase: true, tracking: 0.12, align: "left" },
  sceneBreak: { glyph: "◆ ◆ ◆", family: "montserrat", size: 5 },
  runningHead: { family: "montserrat", size: 7, uppercase: true, tracking: 0.25 },
  folio: { style: { family: "montserrat", size: 8 }, position: "bottom-center", onOpeners: false },
  blockquote: { indent: 1.4, italic: true },
  titlePage: {
    title: { family: "montserrat", size: 32, bold: true, uppercase: true, tracking: 0.1 },
    subtitle: { family: "crimson-pro", size: 14, italic: true },
    author: { family: "montserrat", size: 12, uppercase: true, tracking: 0.3 },
    publisher: { family: "montserrat", size: 7.5, uppercase: true, tracking: 0.25 },
  },
  cover: { background: "#0c0c0f", ink: "#ececec" },
};

const romance: Theme = {
  id: "romance",
  name: "Romance",
  description: "Garamond text, Cormorant italic chapter titles with a flourish, and a two-line drop cap.",
  pro: true,
  body: { family: "eb-garamond", size: 11.5, leading: 15.5, oldstyle: true, justify: true, hyphenate: true, indent: 1.2, blockParagraphs: false },
  margins: { top: 0.8, bottom: 0.85, outside: 0.65, inside: 0.8 },
  chapter: {
    sink: 0.2,
    label: { show: true, format: "numeral", prefix: false, style: { family: "cormorant", size: 30, italic: true } },
    title: { family: "cormorant", size: 22, italic: true, align: "center" },
    ornament: { glyph: "❦", family: "eb-garamond", size: 15 },
    spaceAfter: 2,
  },
  part: { label: { family: "cormorant", size: 13, smallCaps: true, tracking: 0.2 }, title: { family: "cormorant", size: 30, italic: true } },
  firstParagraph: { dropCap: 2, dropCapFamily: "cormorant", leadInWords: 2 },
  heading2: { family: "cormorant", size: 15, italic: true, align: "center" },
  heading3: { family: "cormorant", size: 12, smallCaps: true, tracking: 0.1, align: "center" },
  sceneBreak: { glyph: "❦", family: "eb-garamond", size: 13 },
  runningHead: { family: "cormorant", size: 10, italic: true },
  folio: { style: { family: "cormorant", size: 11 }, position: "bottom-center", onOpeners: false },
  blockquote: { indent: 1.5, italic: true },
  titlePage: {
    title: { family: "cormorant", size: 38, italic: true },
    subtitle: { family: "cormorant", size: 16 },
    author: { family: "cormorant", size: 15, smallCaps: true, tracking: 0.22 },
    publisher: { family: "cormorant", size: 10.5, smallCaps: true, tracking: 0.2 },
  },
  cover: { background: "#f7e3e8", ink: "#5e1d36" },
};

const fantasy: Theme = {
  id: "fantasy",
  name: "Fantasy",
  description: "Garamond with a three-line drop cap, small-caps chapter labels and a fleuron under each chapter title.",
  pro: true,
  body: { family: "eb-garamond", size: 11.5, leading: 15, oldstyle: true, justify: true, hyphenate: true, indent: 1.2, blockParagraphs: false },
  margins: { top: 0.75, bottom: 0.8, outside: 0.625, inside: 0.75 },
  chapter: {
    sink: 0.22,
    label: { show: true, format: "word", prefix: true, style: { family: "eb-garamond", size: 12, smallCaps: true, tracking: 0.25 } },
    title: { family: "eb-garamond", size: 24, bold: true, align: "center" },
    ornament: { glyph: "☙", family: "eb-garamond", size: 18 },
    spaceAfter: 2,
  },
  part: { label: { family: "eb-garamond", size: 13, smallCaps: true, tracking: 0.25 }, title: { family: "eb-garamond", size: 28, bold: true } },
  firstParagraph: { dropCap: 3, dropCapFamily: "eb-garamond", leadInWords: 3 },
  heading2: { family: "eb-garamond", size: 14, bold: true, align: "center" },
  heading3: { family: "eb-garamond", size: 11.5, smallCaps: true, tracking: 0.1, align: "center" },
  sceneBreak: { glyph: "☙", family: "eb-garamond", size: 14 },
  runningHead: { family: "eb-garamond", size: 9.5, smallCaps: true, tracking: 0.15 },
  folio: { style: { family: "eb-garamond", size: 10 }, position: "bottom-center", onOpeners: false },
  blockquote: { indent: 1.5, italic: true },
  titlePage: {
    title: { family: "eb-garamond", size: 34, bold: true },
    subtitle: { family: "eb-garamond", size: 15, italic: true },
    author: { family: "eb-garamond", size: 14, smallCaps: true, tracking: 0.2 },
    publisher: { family: "eb-garamond", size: 10, smallCaps: true, tracking: 0.15 },
  },
  cover: { background: "#1b2a22", ink: "#e9dcae" },
};

export const THEMES: Theme[] = [classic, modern, elegant, nonfiction, largePrint, thriller, romance, fantasy];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? classic;
}
