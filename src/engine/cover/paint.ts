// Small drawing helpers shared by the cover renderers: colours, a text painter
// that turns styled lines into text draws, and a size fitter.

import { Styler, type RunStyle } from "../layout/style";
import type { Draw, Rgb } from "../layout/types";

const PT = 72;

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

export const pt = (inches: number) => inches * PT;

export class Painter {
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

/** Largest size from `max` down to `min` at which `fits` holds, or `min`. */
export function fitSize(max: number, min: number, fits: (size: number) => boolean): { size: number; fits: boolean } {
  for (let size = max; size >= min; size -= 0.5) if (fits(size)) return { size, fits: true };
  return { size: min, fits: fits(min) };
}


/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const rgbToHex = ([r, g, b]: Rgb): string => "#" + [r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");

/** `a` moved `t` (0 to 1) of the way to `b`. */
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
