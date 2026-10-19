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
}

export interface ImageDraw {
  kind: "image";
  x: number;
  /** Top edge. */
  y: number;
  w: number;
  h: number;
  path: string;
  alt: string;
}

export interface RuleDraw {
  kind: "rule";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export type Draw = TextDraw | ImageDraw | RuleDraw;

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
  | "body";

/** A position in the book's text: a block and a character offset into its plain text. */
export interface TextPos {
  blockId: string;
  offset: number;
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
}
