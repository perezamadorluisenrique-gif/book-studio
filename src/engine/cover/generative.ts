// Cover backgrounds drawn from a seed. Six families; each returns draws for a box
// (in points) and uses only the colours it is given, so the author's palette (and
// the contrast of the title on it) is the one thing to check. Same seed, same drawing:
// the random numbers come from a small generator seeded by a hash of the text.

import type { Draw, PathOp, Rgb } from "../layout/types";
import type { GenFamily } from "./design";
import { hexToRgb } from "./paint";

/** A number generator that returns the same sequence for the same seed text. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const K = 0.5522847498;
const circle = (cx: number, cy: number, r: number): PathOp[] => [
  ["M", cx + r, cy],
  ["C", cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r],
  ["C", cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy],
  ["C", cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r],
  ["C", cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy],
  ["Z"],
];
const polygon = (pts: [number, number][]): PathOp[] => [...pts.map((p, i) => [i ? "L" : "M", p[0], p[1]] as PathOp), ["Z"]];
const pick = <T,>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length) % list.length];

type Maker = (box: Box, r: () => number, colors: Rgb[]) => Draw[];

const stripes: Maker = (box, r, colors) => {
  const out: Draw[] = [];
  const slant = (r() - 0.5) * 0.9;
  let x = box.x - Math.abs(slant) * box.h;
  let i = Math.floor(r() * colors.length);
  const end = box.x + box.w + Math.abs(slant) * box.h;
  while (x < end) {
    const w = box.w * (0.03 + r() * 0.1);
    const dx = slant * box.h;
    out.push({ kind: "path", ops: polygon([[x, box.y], [x + w, box.y], [x + w + dx, box.y + box.h], [x + dx, box.y + box.h]]), fill: colors[i % colors.length] });
    x += w * (1 + r() * 1.6);
    i += 1 + Math.floor(r() * 2);
  }
  return out;
};

const circles: Maker = (box, r, colors) => {
  const cx = box.x + box.w * (0.55 + r() * 0.4);
  const cy = box.y + box.h * (0.2 + r() * 0.6);
  const out: Draw[] = [];
  const max = Math.hypot(box.w, box.h) * 0.6;
  const rings = 7 + Math.floor(r() * 5);
  for (let k = rings; k >= 1; k--) out.push({ kind: "path", ops: circle(cx, cy, (max * k) / rings), fill: colors[k % colors.length] });
  return out;
};

const triangles: Maker = (box, r, colors) => {
  const cell = Math.max(box.w, box.h) / (9 + Math.floor(r() * 5));
  const out: Draw[] = [];
  for (let y = box.y; y < box.y + box.h; y += cell) {
    for (let x = box.x; x < box.x + box.w; x += cell) {
      const flip = r() < 0.5;
      const a: [number, number][] = flip ? [[x, y], [x + cell, y], [x, y + cell]] : [[x, y], [x + cell, y], [x + cell, y + cell]];
      const b: [number, number][] = flip ? [[x + cell, y], [x + cell, y + cell], [x, y + cell]] : [[x, y], [x, y + cell], [x + cell, y + cell]];
      out.push({ kind: "path", ops: polygon(a), fill: pick(r, colors) }, { kind: "path", ops: polygon(b), fill: pick(r, colors) });
    }
  }
  return out;
};

const waves: Maker = (box, r, colors) => {
  const out: Draw[] = [];
  const bands = 6 + Math.floor(r() * 4);
  for (let k = 0; k < bands; k++) {
    const base = box.y + box.h * (0.25 + (0.8 * k) / bands);
    const amp = box.h * (0.02 + r() * 0.04);
    const len = box.w * (0.35 + r() * 0.5);
    const phase = r() * Math.PI * 2;
    const ops: PathOp[] = [["M", box.x, box.y + box.h]];
    const steps = 48;
    for (let s = 0; s <= steps; s++) {
      const x = box.x + (box.w * s) / steps;
      ops.push(["L", x, base + Math.sin((x - box.x) / len * Math.PI * 2 + phase) * amp]);
    }
    ops.push(["L", box.x + box.w, box.y + box.h], ["Z"]);
    out.push({ kind: "path", ops, fill: colors[k % colors.length] });
  }
  return out;
};

const blocks: Maker = (box, r, colors) => {
  const out: Draw[] = [];
  const split = (b: Box, depth: number) => {
    if (depth === 0 || (depth < 3 && r() < 0.25)) {
      out.push({ kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h, fill: pick(r, colors) });
      return;
    }
    const t = 0.3 + r() * 0.4;
    if (b.w > b.h) {
      split({ ...b, w: b.w * t }, depth - 1);
      split({ ...b, x: b.x + b.w * t, w: b.w * (1 - t) }, depth - 1);
    } else {
      split({ ...b, h: b.h * t }, depth - 1);
      split({ ...b, y: b.y + b.h * t, h: b.h * (1 - t) }, depth - 1);
    }
  };
  split(box, 4);
  return out;
};

const constellation: Maker = (box, r, colors) => {
  const out: Draw[] = [];
  const n = 38 + Math.floor(r() * 20);
  const pts: [number, number][] = Array.from({ length: n }, () => [box.x + r() * box.w, box.y + r() * box.h]);
  const reach = Math.max(box.w, box.h) * 0.11;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < reach) out.push({ kind: "path", ops: [["M", pts[i][0], pts[i][1]], ["L", pts[j][0], pts[j][1]]], stroke: colors[0], strokeWidth: 0.6 });
    }
  }
  pts.forEach((p, i) => out.push({ kind: "path", ops: circle(p[0], p[1], 1.2 + r() * 2.6), fill: colors[i % colors.length] }));
  return out;
};

const MAKERS: Record<GenFamily, Maker> = { stripes, circles, triangles, waves, blocks, constellation };

/** The draws for one pattern over `box` (points). `palette` are #rrggbb colours; the ground is the caller's. */
export function generativeDraws(family: GenFamily, seed: string, palette: string[], box: Box): Draw[] {
  const colors = palette.map(hexToRgb);
  if (!colors.length) return [];
  return MAKERS[family](box, rng(`${family}:${seed}`), colors);
}
