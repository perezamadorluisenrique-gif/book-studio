// What the cover editor does to a cover design, as pure functions: each one takes a design and
// returns a new one, so undo is just keeping the old ones. No screen code here.

import { serializeCoverDesign, type CoverDesign, type CoverLayer, type ImageLayer, type PanelId, type TextLayer } from "../engine/cover/design";
import { SAFE, SPINE_SAFE, type CoverGeometry } from "../engine/cover/geometry";
import { panelBox } from "../engine/cover/render-design";

// ── History ──

export interface CoverHistory {
  past: CoverDesign[];
  present: CoverDesign;
  future: CoverDesign[];
}

const LIMIT = 100;

export const startHistory = (present: CoverDesign): CoverHistory => ({ past: [], present, future: [] });

/** Make `next` the present; a change that leaves the design the same is not a step. */
export function commit(h: CoverHistory, next: CoverDesign): CoverHistory {
  if (serializeCoverDesign(next) === serializeCoverDesign(h.present)) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

export const canUndo = (h: CoverHistory) => h.past.length > 0;
export const canRedo = (h: CoverHistory) => h.future.length > 0;

export function undo(h: CoverHistory): CoverHistory {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: CoverHistory): CoverHistory {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ── Layers ──

const mapLayer = (d: CoverDesign, id: string, fn: (l: CoverLayer) => CoverLayer): CoverDesign => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) });

export const layerById = (d: CoverDesign, id: string): CoverLayer | undefined => d.layers.find((l) => l.id === id);

/** Change fields of one layer. Its kind, panel and id stay as they are. */
export function patchLayer(d: CoverDesign, id: string, patch: Partial<TextLayer> | Partial<ImageLayer> | { x?: number; y?: number; w?: number; h?: number; color?: string }): CoverDesign {
  return mapLayer(d, id, (l) => ({ ...l, ...patch, id: l.id, kind: l.kind, panel: l.panel }) as CoverLayer);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Move a layer by a fraction of its panel, keeping at least part of it on the panel. */
export function moveLayer(d: CoverDesign, id: string, dx: number, dy: number): CoverDesign {
  return mapLayer(d, id, (l) => ({ ...l, x: clamp(l.x + dx, -l.w * 0.8, 1 - l.w * 0.2), y: clamp(l.y + dy, -l.h * 0.8, 1 - l.h * 0.2) }));
}

/** Resize a layer (fractions of its panel). */
export function resizeLayer(d: CoverDesign, id: string, w: number, h: number): CoverDesign {
  return mapLayer(d, id, (l) => ({ ...l, w: clamp(w, 0.02, 2), h: clamp(h, 0.01, 2) }));
}

export interface SnapGuide {
  panel: PanelId;
  axis: "x" | "y";
  /** Fraction of the panel. */
  at: number;
}

/** The lines a layer's edges and centre snap to: the panel's edges, its safe margins and its middle. */
export function guideLines(g: CoverGeometry, panel: PanelId, axis: "x" | "y"): number[] {
  const b = panelBox(g, panel);
  const side = axis === "x" ? (panel === "spine" ? SPINE_SAFE : SAFE) : SAFE;
  const size = axis === "x" ? b.w : b.h;
  const m = Math.min(side / size, 0.45);
  return [0, m, 0.5, 1 - m, 1];
}

/** Pull a layer's box to the nearest guide when an edge or its centre is within `reach` of one (a fraction of the panel). */
export function snapLayer(d: CoverDesign, id: string, g: CoverGeometry, reach = 0.012): { design: CoverDesign; guides: SnapGuide[] } {
  const l = layerById(d, id);
  if (!l) return { design: d, guides: [] };
  const guides: SnapGuide[] = [];
  const fit = (axis: "x" | "y", pos: number, size: number): number => {
    let best: { delta: number; at: number } | null = null;
    for (const at of guideLines(g, l.panel, axis)) {
      for (const edge of [pos, pos + size / 2, pos + size]) {
        const delta = at - edge;
        if (Math.abs(delta) <= reach && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at };
      }
    }
    if (!best) return pos;
    guides.push({ panel: l.panel, axis, at: best.at });
    return pos + best.delta;
  };
  const x = fit("x", l.x, l.w);
  const y = fit("y", l.y, l.h);
  return { design: mapLayer(d, id, (m) => ({ ...m, x, y })), guides };
}

export function removeLayer(d: CoverDesign, id: string): CoverDesign {
  return { ...d, layers: d.layers.filter((l) => l.id !== id) };
}

/** Move a layer one step towards the front (`+1`) or the back (`-1`). */
export function stackLayer(d: CoverDesign, id: string, step: 1 | -1): CoverDesign {
  const i = d.layers.findIndex((l) => l.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= d.layers.length) return d;
  const layers = [...d.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...d, layers };
}

const uniqueId = (d: CoverDesign, base: string) => {
  let n = d.layers.length + 1;
  while (d.layers.some((l) => l.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
};

export function addTextLayer(d: CoverDesign, panel: PanelId, text: string, color: string): { design: CoverDesign; id: string } {
  const id = uniqueId(d, "text");
  const layer: TextLayer = { id, kind: "text", panel, x: 0.15, y: 0.4, w: 0.7, h: 0.12, text, family: "eb-garamond", size: 22, minSize: 10, color, align: "center", valign: "middle" };
  return { design: { ...d, layers: [...d.layers, layer] }, id };
}

export function addImageLayer(d: CoverDesign, panel: PanelId, target: string, path: string, alt: string): { design: CoverDesign; id: string } {
  const id = uniqueId(d, "picture");
  const layer: ImageLayer = { id, kind: "image", panel, x: 0.15, y: 0.15, w: 0.7, h: 0.4, target, path, alt, fit: "cover" };
  return { design: { ...d, layers: [...d.layers, layer] }, id };
}

/** A short name for a layer in the layer list. */
export function layerName(l: CoverLayer): string {
  if (l.kind === "text") return l.text.replace(/\s+/g, " ").trim().slice(0, 28) || "…";
  if (l.kind === "image") return l.target;
  return l.color;
}

/** Which layers sit inside `panel`, front-most last. */
export const layersOn = (d: CoverDesign, panel: PanelId): CoverLayer[] => d.layers.filter((l) => l.panel === panel);
