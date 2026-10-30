// The full paperback cover as one flat page: back cover, spine and front cover
// with bleed, the barcode area KDP reserves and, when the manifest gives an
// ISBN, a real EAN-13 barcode in it. The result is an ordinary Layout with one
// page, so the PDF writer and the canvas preview draw it like any other page.

import type { FontSet } from "../fonts";
import { fromTextStyle, Styler, type RunStyle } from "../layout/style";
import type { Draw, Layout, Rgb } from "../layout/types";
import type { Book } from "../model";
import { themeById, type TextStyle } from "../themes";
import { checkIsbn, displayIsbn, ean13Modules } from "./isbn";
import { DEFAULT_TRIM, trimById } from "../trims";
import { coverGeometry, PAPER_LABEL, SAFE, SPINE_SAFE, SPINE_TEXT_MIN_PAGES, type Box, type CoverGeometry } from "./geometry";

const PT = 72;

export interface CoverFinding {
  severity: "error" | "warning" | "info";
  message: string;
}

export interface CoverOptions {
  /** Draw bleed, safe-area, spine and barcode guides, for the preview only. */
  guides?: boolean;
}

export interface Cover {
  layout: Layout;
  geometry: CoverGeometry;
  findings: CoverFinding[];
  /** The EAN-13 digits drawn in the barcode box, when the ISBN is valid. */
  barcode?: string;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255];
}

/** Relative luminance from 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Black or white, whichever reads better on `bg`. */
export function contrastInk(bg: Rgb): Rgb {
  return luminance(bg) > 0.35 ? [0.07, 0.07, 0.07] : [1, 1, 1];
}

const pt = (inches: number) => inches * PT;

class Painter {
  readonly draws: Draw[] = [];

  constructor(
    readonly styler: Styler,
    readonly ink: Rgb,
  ) {}

  width(text: string, rs: RunStyle): number {
    return this.styler.width(text, rs);
  }

  /** Wrap `text` to `max` points; words longer than a line stay whole. */
  wrap(text: string, rs: RunStyle, max: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.width(next, rs) > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Draw one line with its left end at (x, baseline y), turned `angle` degrees counter-clockwise. */
  line(text: string, rs: RunStyle, x: number, y: number, color: Rgb = this.ink, angle = 0): number {
    const r = (angle * Math.PI) / 180;
    const dx = Math.cos(r);
    const dy = -Math.sin(r);
    let off = 0;
    for (const p of this.styler.parts(text, rs)) {
      this.draws.push({ kind: "text", x: x + dx * off, y: y + dy * off, text: p.text, face: p.face, size: p.size, tracking: p.tracking || undefined, color, angle: angle || undefined });
      off += this.styler.partWidth(p);
    }
    return off;
  }

  /** A centred line inside [left, left + boxWidth]. */
  centered(text: string, rs: RunStyle, left: number, boxWidth: number, y: number, color?: Rgb): void {
    this.line(text, rs, left + (boxWidth - this.width(text, rs)) / 2, y, color);
  }
}

function rs(ts: TextStyle, oldstyle: boolean, size = ts.size): RunStyle {
  return { ...fromTextStyle(ts, oldstyle), size, tracking: ((ts.tracking ?? 0) * size) };
}

/** Largest size from `max` down to `min` at which `fits` holds, or `min`. */
function fitSize(max: number, min: number, fits: (size: number) => boolean): { size: number; fits: boolean } {
  for (let size = max; size >= min; size -= 0.5) if (fits(size)) return { size, fits: true };
  return { size: min, fits: fits(min) };
}

export function composeCover(book: Book, fonts: FontSet, pages: number, opts: CoverOptions = {}): Cover {
  const { meta, settings } = book;
  const theme = themeById(settings.theme);
  const g = coverGeometry(trimById(settings.trim) ?? trimById(DEFAULT_TRIM)!, pages, settings.paper);
  const design = meta.coverDesign;
  const findings: CoverFinding[] = [];
  const bg = hexToRgb(design.background ?? theme.cover.background);
  const ink = design.ink ? hexToRgb(design.ink) : design.background ? contrastInk(bg) : hexToRgb(theme.cover.ink);
  const painter = new Painter(new Styler(fonts, meta.language), ink);
  const old = theme.body.oldstyle;
  const draws = painter.draws;
  const W = pt(g.width);
  const H = pt(g.height);

  draws.push({ kind: "rect", x: 0, y: 0, w: W, h: H, fill: bg });

  // ── Front ──
  const coverImage = meta.cover && book.images.get(meta.cover.path);
  if (coverImage) {
    const box = { x: pt(g.frontBleed.x), y: pt(g.frontBleed.y), w: pt(g.frontBleed.w), h: pt(g.frontBleed.h) };
    const scale = Math.max(box.w / coverImage.width, box.h / coverImage.height);
    const w = coverImage.width * scale;
    const h = coverImage.height * scale;
    draws.push({ kind: "image", x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, path: coverImage.path, alt: meta.cover?.alt ?? "", clip: box });
    const ppi = PT / scale;
    if (ppi < 300) findings.push({ severity: "warning", message: `The cover image prints at ${Math.round(ppi)} ppi on the front cover; KDP asks for 300 ppi. Use an image at least ${Math.ceil(g.frontBleed.w * 300)} × ${Math.ceil(g.frontBleed.h * 300)} pixels.` });
    const fit = coverImage.width / coverImage.height / (box.w / box.h);
    if (Math.abs(fit - 1) > 0.04) findings.push({ severity: "info", message: `The cover image is not the shape of the front cover, so it is scaled to fill it and the ${fit > 1 ? "sides" : "top and bottom"} are cropped.` });
  } else {
    if (meta.cover) findings.push({ severity: "warning", message: `The cover image ${meta.cover.target} could not be read, so the front cover is typeset from the title.` });
    typographicFront(painter, g, book, theme.titlePage, old, findings);
  }

  // ── Back ──
  backCover(painter, g, book, bg, old, findings);

  // ── Spine ──
  spine(painter, g, book, old, findings);

  // ── Barcode box ──
  const isbn = meta.isbnPrint ? checkIsbn(meta.isbnPrint) : null;
  const bar = barcodeBox(painter, g.barcode, isbn && isbn.ok ? isbn.isbn13 : null, meta.isbnPrint ?? "", old);
  if (!meta.isbnPrint) findings.push({ severity: "info", message: "No ISBN in the manifest, so the barcode area is left blank. KDP places its own barcode there if you let it assign an ISBN." });
  else if (isbn && !isbn.ok) findings.push({ severity: "warning", message: `The ISBN ${meta.isbnPrint} is not valid (${isbn.reason === "checksum" ? "its check digit is wrong" : isbn.reason === "prefix" ? "it doesn't start with 978 or 979" : "it needs 10 or 13 digits"}), so the barcode area is left blank.` });

  if (opts.guides) guides(draws, g);

  const layout: Layout = {
    trim: g.trim,
    widthPt: W,
    heightPt: H,
    bleedPt: 0,
    margins: { top: 0, bottom: 0, inside: 0, outside: 0 },
    pages: [{ index: 0, folio: "1", showFolio: false, recto: true, role: "cover", matter: "front", draws }],
    toc: [],
    warnings: [],
    bodyStart: 0,
  };
  return { layout, geometry: g, findings, barcode: bar ?? undefined };
}

function typographicFront(p: Painter, g: CoverGeometry, book: Book, tp: { title: TextStyle; subtitle: TextStyle; author: TextStyle }, old: boolean, findings: CoverFinding[]): void {
  const { meta } = book;
  const left = pt(g.front.x) + pt(0.6);
  const width = pt(g.front.w) - pt(1.2);
  const top = pt(g.front.y);
  const height = pt(g.front.h);
  const titleStyle = (size: number) => rs(tp.title, old, size);
  const fit = fitSize(tp.title.size * 1.7, 18, (size) => {
    const lines = p.wrap(meta.title, titleStyle(size), width);
    return lines.length <= 4 && lines.length * size * 1.15 <= height * 0.38;
  });
  if (!fit.fits) findings.push({ severity: "warning", message: "The title is too long to set large on the front cover. Shorten it or use a cover image." });
  const size = fit.size;
  const lines = p.wrap(meta.title, titleStyle(size), width);
  let y = top + height * 0.2 + size;
  for (const l of lines) {
    p.centered(l, titleStyle(size), left, width, y);
    y += size * 1.15;
  }
  y += size * 0.2;
  p.draws.push({ kind: "rule", x1: left + width * 0.35, x2: left + width * 0.65, y1: y, y2: y, width: 0.75 });
  y += size * 0.9;
  if (meta.subtitle) {
    const sub = rs(tp.subtitle, old, tp.subtitle.size * 1.15);
    for (const l of p.wrap(meta.subtitle, sub, width)) {
      p.centered(l, sub, left, width, y);
      y += sub.size * 1.3;
    }
  }
  const author = rs(tp.author, old, tp.author.size * 1.3);
  const name = meta.authors.join(meta.language.startsWith("es") ? " y " : " & ");
  if (name) {
    const lines2 = p.wrap(name, author, width);
    let ay = top + height - pt(0.9) - (lines2.length - 1) * author.size * 1.3;
    for (const l of lines2) {
      p.centered(l, author, left, width, ay);
      ay += author.size * 1.3;
    }
  }
}

function backCover(p: Painter, g: CoverGeometry, book: Book, bg: Rgb, old: boolean, findings: CoverFinding[]): void {
  const { meta } = book;
  const design = meta.coverDesign;
  const theme = themeById(book.settings.theme);
  const left = pt(g.back.x) + pt(0.6);
  const right = pt(g.back.x + g.back.w) - pt(0.55);
  const width = right - left;
  const top = pt(g.back.y) + pt(0.75);
  const bottom = pt(g.back.y + g.back.h) - pt(SAFE);
  const barTop = pt(g.barcode.y);
  const bodyStyle = (size: number): RunStyle => ({ family: theme.body.family, size, oldstyle: old });
  const dim = (c: Rgb): Rgb => [bgMix(c[0], bg[0]), bgMix(c[1], bg[1]), bgMix(c[2], bg[2])];

  // Author bio sits to the left of the barcode, bottom-aligned with it.
  let bioTop = barTop;
  const bioLeft = left;
  const bioRight = pt(g.barcode.x) - pt(0.2);
  if (design.bio.length) {
    const photo = design.photo && book.images.get(design.photo.path);
    const photoSize = photo ? pt(0.85) : 0;
    const textLeft = bioLeft + (photo ? photoSize + pt(0.12) : 0);
    const fit = fitSize(9, 7, (size) => {
      const lines = design.bio.flatMap((para) => p.wrap(para, bodyStyle(size), bioRight - textLeft));
      return lines.length * size * 1.3 <= pt(g.barcode.h) + pt(0.15);
    });
    const style = bodyStyle(fit.size);
    const lines = design.bio.flatMap((para) => p.wrap(para, style, bioRight - textLeft));
    if (!fit.fits) findings.push({ severity: "warning", message: "The author bio is too long for the space beside the barcode, so it was cut short. Shorten it." });
    const room = Math.floor((pt(g.barcode.h) + pt(0.15)) / (fit.size * 1.3));
    const shown = lines.slice(0, Math.max(room, 1));
    const bioHeight = shown.length * fit.size * 1.3;
    let y = bottom - bioHeight + fit.size;
    for (const l of shown) {
      p.line(l, style, textLeft, y, dim(p.ink));
      y += fit.size * 1.3;
    }
    bioTop = Math.min(barTop, bottom - bioHeight - fit.size * 0.3);
    if (photo && design.photo) {
      const scale = Math.max(photoSize / photo.width, photoSize / photo.height);
      const w = photo.width * scale;
      const h = photo.height * scale;
      const box = { x: bioLeft, y: bottom - photoSize, w: photoSize, h: photoSize };
      p.draws.push({ kind: "image", x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, path: photo.path, alt: design.photo.alt, clip: box });
    }
  }

  // Tagline and blurb fill the space above.
  const room = Math.min(bioTop, barTop) - pt(0.25) - top;
  const blurb = design.blurb;
  if (!blurb.length && !design.tagline) {
    findings.push({ severity: "info", message: "The back cover has no text. Add back-blurb (or description) to the manifest to print a blurb there." });
    return;
  }
  const taglineStyle = (size: number): RunStyle => ({ family: themeById(book.settings.theme).titlePage.subtitle.family, size, italic: true, oldstyle: old });
  const para = 0.6;
  const fit = fitSize(12, 8.5, (size) => {
    const tagH = design.tagline ? p.wrap(design.tagline, taglineStyle(size * 1.35), width).length * size * 1.35 * 1.25 + size : 0;
    const lines = blurb.map((b) => p.wrap(b, bodyStyle(size), width).length);
    const h = lines.reduce((a, n) => a + n * size * 1.35, 0) + Math.max(blurb.length - 1, 0) * size * para;
    return tagH + h <= room;
  });
  if (!fit.fits) findings.push({ severity: "warning", message: `The back-cover text is too long to fit above the barcode and bio, even at ${fit.size} pt. Shorten the blurb.` });
  let y = top + fit.size;
  if (design.tagline) {
    const ts = taglineStyle(fit.size * 1.35);
    for (const l of p.wrap(design.tagline, ts, width)) {
      p.line(l, ts, left, y);
      y += ts.size * 1.25;
    }
    y += fit.size * 0.8;
  }
  const style = bodyStyle(fit.size);
  for (const b of blurb) {
    for (const l of p.wrap(b, style, width)) {
      if (y > top + room + fit.size) return;
      p.line(l, style, left, y);
      y += fit.size * 1.35;
    }
    y += fit.size * para;
  }
}

function bgMix(ink: number, bg: number): number {
  return ink * 0.85 + bg * 0.15;
}

function spine(p: Painter, g: CoverGeometry, book: Book, old: boolean, findings: CoverFinding[]): void {
  const { meta } = book;
  const theme = themeById(book.settings.theme);
  if (!g.spineText) {
    findings.push({ severity: "info", message: `No text on the spine: KDP prints spine text only on books of ${SPINE_TEXT_MIN_PAGES} pages or more, and this one has ${g.pages}.` });
    return;
  }
  const title = meta.coverDesign.spineTitle ?? meta.title;
  const author = meta.authors.join(", ");
  const avail = pt(g.spineBox.h) - pt(1.0);
  const thickness = pt(g.spine) - 2 * pt(SPINE_SAFE);
  const family = theme.titlePage.title.family;
  const authorFamily = theme.titlePage.author.family;
  const style = (size: number): RunStyle => ({ family, size, bold: theme.titlePage.title.bold, italic: theme.titlePage.title.italic, uppercase: theme.titlePage.title.uppercase, oldstyle: old, tracking: (theme.titlePage.title.tracking ?? 0) * size });
  const authorStyle = (size: number): RunStyle => ({ family: authorFamily, size, bold: false, uppercase: theme.titlePage.author.uppercase, caps: theme.titlePage.author.smallCaps ? "all" : "none", oldstyle: old, tracking: (theme.titlePage.author.tracking ?? 0) * size });
  const gap = pt(0.35);
  // Title and author on one line, title first; the title gives way before the author.
  const fits = (size: number) => p.width(title, style(size)) + (author ? gap + p.width(author, authorStyle(size * 0.8)) : 0) <= avail;
  const maxSize = Math.min(thickness * 0.62, 28);
  const fit = fitSize(maxSize, 6.5, fits);
  let showAuthor = !!author;
  let size = fit.size;
  if (!fit.fits && author) {
    showAuthor = false;
    const alone = fitSize(maxSize, 6.5, (s) => p.width(title, style(s)) <= avail);
    size = alone.size;
    if (!alone.fits) findings.push({ severity: "warning", message: "The title is too long for the spine even in small type. Give spine-title: a shorter text in the manifest." });
    else findings.push({ severity: "info", message: "The author's name was left off the spine to keep the title legible." });
  }
  if (size < 8) findings.push({ severity: "warning", message: `The spine type is only ${size} pt because the spine is ${g.spine.toFixed(3)} in thick. Consider a shorter spine-title.` });
  // Text turned clockwise reads top to bottom; its baseline sits left of centre.
  const cx = pt(g.spineBox.x) + pt(g.spine) / 2;
  const baselineX = cx - size * 0.3;
  p.line(title, style(size), baselineX, pt(g.spineBox.y) + pt(0.5), undefined, -90);
  if (showAuthor) {
    const as = authorStyle(size * 0.8);
    const w = p.width(author, as);
    p.line(author, as, cx - size * 0.8 * 0.3, pt(g.spineBox.y + g.spineBox.h) - pt(0.5) - w, undefined, -90);
  }
}

/** Draw the white barcode box; returns the EAN-13 digits when a real barcode was drawn. */
function barcodeBox(p: Painter, box: Box, isbn13: string | null, written: string, old: boolean): string | null {
  const x = pt(box.x);
  const y = pt(box.y);
  const w = pt(box.w);
  const h = pt(box.h);
  p.draws.push({ kind: "rect", x, y, w, h, fill: [1, 1, 1] });
  if (!isbn13) return null;
  const modules = ean13Modules(isbn13);
  // 95 modules plus quiet zones of 11 and 7 modules; the digits sit under the bars.
  const quietL = 11;
  const total = 95 + quietL + 7;
  const m = w / total;
  const barTop = y + h * 0.2;
  const barH = h * 0.62;
  const label: RunStyle = { family: "eb-garamond", size: 8, oldstyle: false };
  const text = `ISBN ${displayIsbn(written, isbn13)}`;
  p.line(text, label, x + (w - p.width(text, label)) / 2, y + h * 0.13, [0, 0, 0]);
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (j < modules.length && modules[j] === "1") j++;
    // Guard bars (start, centre, end) reach lower than the others.
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    p.draws.push({ kind: "rect", x: x + (quietL + i) * m, y: barTop, w: (j - i) * m, h: guard ? barH + h * 0.06 : barH, fill: [0, 0, 0] });
    i = j;
  }
  const digit = (c: string, at: number) => p.line(c, { family: "inconsolata", size: 9 }, x + (quietL + at) * m - p.width(c, { family: "inconsolata", size: 9 }) / 2, barTop + barH + h * 0.15, [0, 0, 0]);
  digit(isbn13[0], -5);
  for (let k = 0; k < 6; k++) digit(isbn13[1 + k], 3 + 7 * k + 3.5);
  for (let k = 0; k < 6; k++) digit(isbn13[7 + k], 50 + 7 * k + 3.5);
  return isbn13;
}

function guides(draws: Draw[], g: CoverGeometry): void {
  const trimLine: Rgb = [0.85, 0.2, 0.2];
  const safeLine: Rgb = [0.2, 0.45, 0.85];
  const dash = [4, 3];
  const rect = (b: Box, stroke: Rgb) => draws.push({ kind: "rect", x: pt(b.x), y: pt(b.y), w: pt(b.w), h: pt(b.h), stroke, strokeWidth: 0.6, dash });
  rect({ x: g.bleed, y: g.bleed, w: g.width - 2 * g.bleed, h: g.height - 2 * g.bleed }, trimLine);
  for (const panel of [g.back, g.front]) rect({ x: panel.x + SAFE, y: panel.y + SAFE, w: panel.w - 2 * SAFE, h: panel.h - 2 * SAFE }, safeLine);
  rect(g.spineBox, trimLine);
  if (g.spine > 2 * SPINE_SAFE) rect({ x: g.spineBox.x + SPINE_SAFE, y: g.spineBox.y, w: g.spine - 2 * SPINE_SAFE, h: g.spineBox.h }, safeLine);
  rect(g.barcode, [0.1, 0.1, 0.1]);
}

export const coverSummary = (g: CoverGeometry): string => `${g.width.toFixed(3)} × ${g.height.toFixed(3)} in with bleed; spine ${g.spine.toFixed(3)} in on ${PAPER_LABEL[g.paper]}`;
