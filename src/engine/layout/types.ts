// What the typesetter produces: positioned glyph runs, images and rules on
// trimmed pages. Coordinates are points from the top-left corner of the trim box;
// the PDF writer and the preview add bleed and flip the y axis as they need.

import type { FaceKey } from "../fonts";
import type { Matter, SourceRef } from "../model";
import type { Trim } from "../trims";

export interface TextDraw {
  kind: "text";
  x: number;
  /** Baseline, measured down from the top of the page. */
  y: number;
  text: string;
  face: FaceKey;
  size: number;
  /** Extra space after every glyph, in points. */
  tracking?: number;
  /** Horizontal stretch of the glyphs (1 = none), from letter expansion; absent means 1. */
  scale?: number;
  /** Fill colour as red, green, blue from 0 to 1; black when absent. */
  color?: Rgb;
  /** Rotation in degrees, counter-clockwise, about (x, y); -90 reads top to bottom, as on a spine. */
  angle?: number;
}

export type Rgb = [number, number, number];

export interface ImageDraw {
  kind: "image";
  x: number;
  /** Top edge. */
  y: number;
  w: number;
  h: number;
  path: string;
  alt: string;
  /** Show only this part of the image (same coordinates as x, y, w, h). */
  clip?: { x: number; y: number; w: number; h: number };
}

export interface RuleDraw {
  kind: "rule";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

/** A filled and/or outlined rectangle; covers and guides use them, body pages do not. */
export interface RectDraw {
  kind: "rect";
  x: number;
  /** Top edge. */
  y: number;
  w: number;
  h: number;
  fill?: Rgb;
  stroke?: Rgb;
  strokeWidth?: number;
  /** Dash pattern in points, for guides. */
  dash?: number[];
}

export type Draw = TextDraw | ImageDraw | RuleDraw | RectDraw;

export type PageRole =
  | "blank"
  | "half-title"
  | "also-by"
  | "title"
  | "copyright"
  | "dedication"
  | "epigraph"
  | "toc"
  | "part"
  | "opener"
  | "body"
  | "cover";

/** A position in the book's text: a block and a character offset into its plain text. */
export interface TextPos {
  blockId: string;
  offset: number;
}

/** Typographic defects counted on one page of running text. */
export interface PageStats {
  /** Lines of body paragraphs. */
  lines: number;
  /** Lines whose spaces were stretched past their natural stretch (ratio above 1), and past twice that. */
  loose: number;
  veryLoose: number;
  /** Lines ending in a hyphen. */
  hyphens: number;
  /** Times three hyphenated lines in a row were reached. */
  ladders: number;
  /** Whole lines the page is short of full; 0 on the last page of a flow. */
  short: number;
  /** Lines the page runs past the foot, with its facing page; 0 on the last page of a flow. */
  long: number;
  /** 1 when the last line of the page ends in a hyphen. */
  hyphenEnd: number;
  /** 1 when the page ends on the first line of a longer paragraph (orphan), or starts on the last line of one (widow). */
  orphans: number;
  widows: number;
  /** Paragraphs the page builder re-set with one line more or less. */
  adjusted: number;
}

/** The page stats of the whole book, summed, plus counts that need neighbouring pages. */
export interface Quality extends PageStats {
  /** Pages that carry stats. */
  pages: number;
  /** Pages with `short > 0`. */
  shortPages: number;
  /** Pages with `long > 0`: not a defect when the facing page matches, but worth watching. */
  longPages: number;
  /** Facing pages of one chapter, neither the chapter's last, that end at different heights. */
  unevenSpreads: number;
  /** Right-hand pages that end on a hyphen. */
  hyphenTurns: number;
}

export interface LayoutPage {
  /** 0-based physical page index. */
  index: number;
  /** The page number as printed ("iii", "12"), whether or not it is shown. */
  folio: string;
  showFolio: boolean;
  recto: boolean;
  role: PageRole;
  matter: Matter;
  chapterId?: string;
  draws: Draw[];
  /** Where the page's text starts, for the EPUB page list. */
  start?: TextPos;
  stats?: PageStats;
}

export interface TocEntry {
  chapterId: string;
  title: string;
  folio: string;
  level: number;
  matter: Matter;
}

export interface LayoutWarning {
  message: string;
  src?: SourceRef;
  /** Printed page number. */
  page?: string;
  severity: "error" | "warning" | "info";
}

export interface Margins {
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

export interface Layout {
  trim: Trim;
  widthPt: number;
  heightPt: number;
  bleedPt: number;
  /** Margins in points, after KDP minimums are applied. */
  margins: Margins;
  pages: LayoutPage[];
  toc: TocEntry[];
  warnings: LayoutWarning[];
  /** Folio of the first body page's physical index, for jumping in the preview. */
  bodyStart: number;
  quality: Quality;
}
