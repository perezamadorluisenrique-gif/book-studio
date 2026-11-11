// The EAN-13 barcode of an ISBN-13 as plain bars: the same bar pattern the cover designer prints,
// returned as runs (for a canvas) or as an SVG string (for the page and the download).

import { ean13Modules } from "../../../src/engine/cover/isbn";

export interface Bar {
  /** First module of the bar, counted from the left edge of the symbol. */
  x: number;
  w: number;
}

/** 95 modules, plus a quiet zone of 11 modules on the left and 7 on the right (GS1 EAN-13 rules). */
export const QUIET = { left: 11, right: 7 } as const;
export const MODULES = 95;

export function barRuns(isbn13: string): Bar[] {
  const m = ean13Modules(isbn13);
  const bars: Bar[] = [];
  for (let i = 0; i < m.length; ) {
    if (m[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (j < m.length && m[j] === "1") j++;
    bars.push({ x: i, w: j - i });
    i = j;
  }
  return bars;
}

const isGuard = (x: number) => x < 3 || (x >= 45 && x < 50) || x >= 92;

/** An SVG of the barcode with the digits under it. `module` is the width of one module in SVG units. */
export function barcodeSvg(isbn13: string, module = 2): string {
  const bars = barRuns(isbn13);
  const total = QUIET.left + MODULES + QUIET.right;
  const W = total * module;
  const bar = 60 * module;
  const H = bar + 14 * module;
  const rect = (b: Bar) => {
    const h = isGuard(b.x) ? bar + 5 * module : bar;
    return `<rect x="${(QUIET.left + b.x) * module}" y="0" width="${b.w * module}" height="${h}"/>`;
  };
  const size = 9 * module;
  const left = isbn13.slice(1, 7);
  const right = isbn13.slice(7);
  const digit = (s: string, from: number) => `<text x="${(QUIET.left + from) * module}" y="${bar + 12 * module}" font-size="${size}" font-family="Helvetica, Arial, sans-serif" textLength="${42 * module}" lengthAdjust="spacing">${s}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="EAN-13 ${isbn13}"><rect width="${W}" height="${H}" fill="#fff"/><g fill="#000">${bars.map(rect).join("")}<text x="${(QUIET.left - 8) * module}" y="${bar + 12 * module}" font-size="${size}" font-family="Helvetica, Arial, sans-serif">${isbn13[0]}</text>${digit(left, 4)}${digit(right, 51)}</g></svg>`;
}
