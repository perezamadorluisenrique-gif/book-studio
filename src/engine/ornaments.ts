// Vector ornaments for chapter heads and scene breaks. Each is drawn in a box 100 wide and 20 high and scaled to
// the width a style asks for, so it prints and previews as a path and goes into the EPUB as inline SVG.

import type { PathOp } from "./layout/types";

/** Where an ornament is drawn: a path in the 100 × 20 box and the width it takes on the page, in points. */
export interface VectorOrnament {
  path: string;
  width: number;
}

export const ORNAMENT_BOX = { width: 100, height: 20 };

const K = 0.5523;
const circle = (cx: number, cy: number, r: number): PathOp[] => [
  ["M", cx + r, cy],
  ["C", cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r],
  ["C", cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy],
  ["C", cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r],
  ["C", cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy],
  ["Z"],
];
const poly = (pts: [number, number][]): PathOp[] => [...pts.map((p, i) => [i ? "L" : "M", p[0], p[1]] as PathOp), ["Z"]];
const diamond = (cx: number, cy: number, r: number): PathOp[] => poly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]);
const bar = (x1: number, x2: number, cy: number, h: number): PathOp[] => poly([[x1, cy - h / 2], [x2, cy - h / 2], [x2, cy + h / 2], [x1, cy + h / 2]]);
/** A leaf: a lens from (x1, cy) to (x2, cy), `bulge` high. */
const leaf = (x1: number, x2: number, cy: number, bulge: number): PathOp[] => {
  const m = (x1 + x2) / 2;
  return [["M", x1, cy], ["C", x1 + (m - x1) * 0.6, cy - bulge * 1.3, x2 - (x2 - m) * 0.6, cy - bulge * 1.3, x2, cy], ["C", x2 - (x2 - m) * 0.6, cy + bulge * 1.3, x1 + (m - x1) * 0.6, cy + bulge * 1.3, x1, cy], ["Z"]];
};
const star = (cx: number, cy: number, r: number): PathOp[] => {
  const i = r * 0.28;
  return poly([[cx, cy - r], [cx + i, cy - i], [cx + r, cy], [cx + i, cy + i], [cx, cy + r], [cx - i, cy + i], [cx - r, cy], [cx - i, cy - i]]);
};
const wave = (x1: number, x2: number, cy: number, amp: number, thick: number): PathOp[] => {
  const w = (x2 - x1) / 4;
  const top: PathOp[] = [["M", x1, cy], ["C", x1 + w * 0.5, cy - amp, x1 + w * 1.5, cy - amp, x1 + w * 2, cy], ["C", x1 + w * 2.5, cy + amp, x1 + w * 3.5, cy + amp, x2, cy]];
  const back: PathOp[] = [["L", x2, cy + thick], ["C", x1 + w * 3.5, cy + amp + thick, x1 + w * 2.5, cy + amp + thick, x1 + w * 2, cy + thick], ["C", x1 + w * 1.5, cy - amp + thick, x1 + w * 0.5, cy - amp + thick, x1, cy + thick], ["Z"]];
  return [...top, ...back];
};

export interface OrnamentDef {
  id: string;
  name: string;
  ops: PathOp[];
}

export const ORNAMENTS: OrnamentDef[] = [
  { id: "rule", name: "Short rule", ops: bar(30, 70, 10, 0.8) },
  { id: "diamond", name: "Diamond", ops: diamond(50, 10, 5) },
  { id: "dots", name: "Three dots", ops: [...circle(40, 10, 1.9), ...circle(50, 10, 1.9), ...circle(60, 10, 1.9)] },
  { id: "diamond-rule", name: "Rule with diamond", ops: [...bar(18, 43, 10, 0.7), ...diamond(50, 10, 4), ...bar(57, 82, 10, 0.7)] },
  { id: "wave", name: "Wave", ops: wave(28, 72, 9, 4, 1) },
  { id: "lozenges", name: "Three lozenges", ops: [...diamond(36, 10, 3.6), ...diamond(50, 10, 3.6), ...diamond(64, 10, 3.6)] },
  { id: "star", name: "Four-point star", ops: star(50, 10, 8) },
  { id: "leaves", name: "Pair of leaves", ops: [...leaf(26, 47, 10, 3.4), ...leaf(53, 74, 10, 3.4), ...diamond(50, 10, 1.8)] },
];

const fix = (n: number) => +n.toFixed(2);

/** SVG path data (absolute M, L, C, Z) for a list of operations. */
export function toPathData(ops: PathOp[]): string {
  return ops.map((o) => (o[0] === "Z" ? "Z" : `${o[0]}${o.slice(1).map((n) => fix(n as number)).join(" ")}`)).join("");
}

/** The inverse of toPathData for the commands it writes. */
export function parsePathData(d: string): PathOp[] {
  const out: PathOp[] = [];
  for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    if (m[1] === "Z") {
      out.push(["Z"]);
      continue;
    }
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    out.push(m[1] === "C" ? ["C", n[0], n[1], n[2], n[3], n[4], n[5]] : [m[1] as "M" | "L", n[0], n[1]]);
  }
  return out;
}

/** The ornament with this id, as the path and width a style stores. */
export function ornamentById(id: string, width: number): VectorOrnament | undefined {
  const def = ORNAMENTS.find((o) => o.id === id);
  return def ? { path: toPathData(def.ops), width } : undefined;
}

/** The path data scaled to `width` points, with its top-left corner at (x, y). */
export function scaleOps(path: string, width: number, x: number, y: number): PathOp[] {
  const s = width / ORNAMENT_BOX.width;
  return parsePathData(path).map((o) => (o[0] === "Z" ? o : o[0] === "C" ? ["C", x + o[1] * s, y + o[2] * s, x + o[3] * s, y + o[4] * s, x + o[5] * s, y + o[6] * s] : [o[0], x + o[1] * s, y + o[2] * s]));
}

/** Height of an ornament on the page, in points. */
export const ornamentHeight = (o: VectorOrnament): number => (o.width * ORNAMENT_BOX.height) / ORNAMENT_BOX.width;
