// A cover as layers: a background and a list of text, picture and colour-block
// layers, each placed on one panel (back, spine or front) by fractions of that
// panel, so the same design follows any trim size or page count. The design is
// plain JSON: it is kept in the project, read back with `parseCoverDesign` (which
// never throws and fixes what it can), and drawn by `render-design.ts`.

export type PanelId = "back" | "spine" | "front";

export const GEN_FAMILIES = ["stripes", "circles", "triangles", "waves", "blocks", "constellation"] as const;
export type GenFamily = (typeof GEN_FAMILIES)[number];

/** `color` is always the base colour: the whole fill for "color", the first stop of a gradient, the ground under a pattern. */
export type CoverBackground =
  | { kind: "color"; color: string }
  /** `color` to `to`, `angle` degrees: 0 left to right, 90 top to bottom. */
  | { kind: "gradient"; color: string; to: string; angle: number }
  /** A pattern drawn from `seed` in the colours of `palette` over `color`. The same seed always gives the same drawing. */
  | { kind: "generative"; color: string; family: GenFamily; seed: string; palette: string[] }
  /** One picture over the whole flat sheet (a wraparound image made elsewhere). */
  | { kind: "image"; color: string; target: string; alt: string; path?: string };

interface LayerBase {
  id: string;
  panel: PanelId;
  /** Box inside the panel, as fractions of its width and height (0 to 1). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  /** Lines are split at newlines; each paragraph wraps inside the box. */
  text: string;
  family: string;
  /** Largest size in points; the text shrinks down to `minSize` to fit the box. */
  size: number;
  minSize?: number;
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  /** Letter spacing in em. */
  tracking?: number;
  /** Line height as a multiple of the size. */
  lineHeight?: number;
  /** Spine text reads top to bottom: the box is then drawn along the spine's length. */
  rotate?: boolean;
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  /** The picture as the book names it (an asset or vault file name). */
  target: string;
  /** Vault path, filled in when the book is read. */
  path?: string;
  alt: string;
  fit: "cover" | "contain";
  /** Run the picture into the bleed on the sides of the panel that touch the edge of the sheet. */
  bleed?: boolean;
  /** Crop: 1 fits the box, bigger zooms in (up to 4). */
  zoom?: number;
  /** Which part stays in view when the picture is cropped: 0 is the left or top, 1 the right or bottom. */
  focusX?: number;
  focusY?: number;
  /** Darken (above 0) or lighten (below 0) the picture, from -0.8 to 0.8, with a veil of black or white. */
  dim?: number;
}

export interface RectLayer extends LayerBase {
  kind: "rect";
  color: string;
  bleed?: boolean;
}

export type CoverLayer = TextLayer | ImageLayer | RectLayer;

export interface CoverDesign {
  version: 1;
  /** The template it started from, if any. */
  template?: string;
  background: CoverBackground;
  layers: CoverLayer[];
}

export const PANELS: PanelId[] = ["back", "spine", "front"];

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);

export function emptyDesign(background = "#ffffff"): CoverDesign {
  return { version: 1, background: { kind: "color", color: background }, layers: [] };
}

export interface ParsedDesign {
  design: CoverDesign;
  /** What was wrong in the file, in words, for the author. */
  problems: string[];
}

/** Read a design from parsed JSON. Unknown layers are dropped, numbers are put in range, colours that are not #rrggbb are replaced. */
export function parseCoverDesign(raw: unknown): ParsedDesign {
  const problems: string[] = [];
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return { design: emptyDesign(), problems: ["The cover design is not a JSON object."] };
  if (o.version !== 1) problems.push("The cover design has an unknown version; it was read as version 1.");

  const b = o.background && typeof o.background === "object" ? (o.background as Record<string, unknown>) : {};
  const bgColor = color(b.color, "#ffffff");
  const family = GEN_FAMILIES.find((f) => f === b.family);
  const palette = (Array.isArray(b.palette) ? b.palette : []).map((c) => color(c, "")).filter(Boolean).slice(0, 5);
  const background: CoverBackground =
    b.kind === "image" && str(b.target)
      ? { kind: "image", color: bgColor, target: str(b.target), alt: str(b.alt) }
      : b.kind === "gradient"
        ? { kind: "gradient", color: bgColor, to: color(b.to, bgColor), angle: clamp(num(b.angle, 90), -360, 360) }
        : b.kind === "generative" && family && palette.length
          ? { kind: "generative", color: bgColor, family, seed: str(b.seed), palette }
          : { kind: "color", color: bgColor };

  const layers: CoverLayer[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(o.layers) ? o.layers : [];
  list.forEach((item, i) => {
    const l = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const panel = PANELS.find((p) => p === l?.panel);
    if (!l || !panel || (l.kind !== "text" && l.kind !== "image" && l.kind !== "rect")) {
      problems.push(`Layer ${i + 1} was dropped: it needs a kind (text, image or rect) and a panel (back, spine or front).`);
      return;
    }
    let id = str(l.id) || `layer-${i + 1}`;
    while (seen.has(id)) id += "-2";
    seen.add(id);
    const box = { id, panel, x: clamp(num(l.x, 0), -0.5, 1.5), y: clamp(num(l.y, 0), -0.5, 1.5), w: clamp(num(l.w, 1), 0.01, 2), h: clamp(num(l.h, 1), 0.01, 2) };
    if (l.kind === "text") {
      const size = clamp(num(l.size, 12), 4, 200);
      layers.push({
        ...box,
        kind: "text",
        text: str(l.text),
        family: str(l.family, "eb-garamond"),
        size,
        minSize: l.minSize === undefined ? undefined : clamp(num(l.minSize, size), 4, size),
        color: color(l.color, "#111111"),
        align: l.align === "center" || l.align === "right" ? l.align : "left",
        valign: l.valign === "middle" || l.valign === "bottom" ? l.valign : "top",
        bold: l.bold === true || undefined,
        italic: l.italic === true || undefined,
        uppercase: l.uppercase === true || undefined,
        tracking: l.tracking === undefined ? undefined : clamp(num(l.tracking, 0), -0.2, 1),
        lineHeight: l.lineHeight === undefined ? undefined : clamp(num(l.lineHeight, 1.2), 0.8, 3),
        rotate: l.rotate === true || undefined,
      });
    } else if (l.kind === "image") {
      if (!str(l.target)) {
        problems.push(`Layer ${id} was dropped: a picture layer needs a file name.`);
        return;
      }
      layers.push({ ...box, kind: "image", target: str(l.target), alt: str(l.alt), fit: l.fit === "contain" ? "contain" : "cover", bleed: l.bleed === true || undefined, ...imageCrop(l) });
    } else {
      layers.push({ ...box, kind: "rect", color: color(l.color, "#000000"), bleed: l.bleed === true || undefined });
    }
  });

  const design: CoverDesign = { version: 1, background, layers };
  if (typeof o.template === "string") design.template = o.template;
  return { design, problems };
}

function imageCrop(l: Record<string, unknown>): Pick<ImageLayer, "zoom" | "focusX" | "focusY" | "dim"> {
  const out: Pick<ImageLayer, "zoom" | "focusX" | "focusY" | "dim"> = {};
  if (l.zoom !== undefined && num(l.zoom, 1) !== 1) out.zoom = clamp(num(l.zoom, 1), 1, 4);
  if (l.focusX !== undefined && num(l.focusX, 0.5) !== 0.5) out.focusX = clamp(num(l.focusX, 0.5), 0, 1);
  if (l.focusY !== undefined && num(l.focusY, 0.5) !== 0.5) out.focusY = clamp(num(l.focusY, 0.5), 0, 1);
  if (l.dim !== undefined && num(l.dim, 0) !== 0) out.dim = clamp(num(l.dim, 0), -0.8, 0.8);
  return out;
}

/** The design as the text kept in the project. Reading it through `parseCoverDesign` first gives every key a fixed place and drops file paths, so equal designs give equal text. */
export function serializeCoverDesign(d: CoverDesign): string {
  const { design } = parseCoverDesign(d);
  return JSON.stringify(design, null, 2) + "\n";
}
