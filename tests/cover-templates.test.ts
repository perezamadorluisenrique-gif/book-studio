import { beforeAll, describe, expect, it } from "vitest";
import { coverTemplateAllowed, FREE_COVER_TEMPLATE_IDS } from "../src/engine/entitlements";
import { GEN_FAMILIES, parseCoverDesign, serializeCoverDesign, type CoverDesign, type TextLayer } from "../src/engine/cover/design";
import { coverGeometry } from "../src/engine/cover/geometry";
import { generativeDraws, rng } from "../src/engine/cover/generative";
import { contrastRatio, hexToRgb, Painter } from "../src/engine/cover/paint";
import { layerBox, renderDesign } from "../src/engine/cover/render-design";
import { COVER_TEMPLATES, FREE_COVER_TEMPLATES, type CoverInfo } from "../src/engine/cover/templates";
import type { FontSet } from "../src/engine/fonts";
import { Styler } from "../src/engine/layout/style";
import { trimById } from "../src/engine/trims";
import { testFonts } from "./helpers/fonts";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const info: CoverInfo = {
  title: "The Lighthouse Keeper",
  subtitle: "A novel of storms and secrets",
  authors: ["Jane Doe"],
  language: "en",
  tagline: "Some lights should stay dark.",
  blurb: ["When the storm took the last supply boat, Mara was left alone on the rock with the lamp, the logbooks and a visitor nobody had seen arrive.", "A quiet, creeping story about duty, fear and the things the sea gives back."],
  bio: ["Jane Doe grew up on the coast and writes about those who stay behind."],
  variant: 1,
};

const FORMATS = ["5x8", "6x9", "8.5x11"];
const PAGES = [120, 300, 600];

/** Colours a text layer can sit on: the block it is inside, or everything the background can show. */
function under(d: CoverDesign, t: TextLayer, g: ReturnType<typeof coverGeometry>): string[] {
  const tb = layerBox(g, t);
  for (const l of d.layers) {
    if (l.kind !== "rect" || l.panel !== t.panel) continue;
    const b = layerBox(g, l);
    if (tb.x >= b.x - 1e-6 && tb.y >= b.y - 1e-6 && tb.x + tb.w <= b.x + b.w + 1e-6 && tb.y + tb.h <= b.y + b.h + 1e-6 && b.w > 0.3 && b.h > 0.1) return [l.color];
  }
  const bg = d.background;
  return bg.kind === "gradient" ? [bg.color, bg.to] : bg.kind === "generative" ? [bg.color, ...bg.palette] : [bg.color];
}

describe("templates", () => {
  it("are eight free and twelve Pro, with distinct names", () => {
    expect(COVER_TEMPLATES).toHaveLength(20);
    expect(FREE_COVER_TEMPLATES).toHaveLength(8);
    expect(new Set(COVER_TEMPLATES.map((t) => t.id)).size).toBe(20);
    expect(new Set(COVER_TEMPLATES.map((t) => t.name)).size).toBe(20);
    expect(COVER_TEMPLATES.filter((t) => t.generative).map((t) => t.generative).sort()).toEqual(expect.arrayContaining([...GEN_FAMILIES]));
  });

  it("are free or Pro as the entitlements say", () => {
    expect(FREE_COVER_TEMPLATES.map((t) => t.id).sort()).toEqual([...FREE_COVER_TEMPLATE_IDS].sort());
    for (const t of COVER_TEMPLATES) expect(coverTemplateAllowed("free", t.id)).toBe(!t.pro);
    for (const t of COVER_TEMPLATES) expect(coverTemplateAllowed("pro", t.id)).toBe(true);
  });

  const cases = COVER_TEMPLATES.flatMap((t) => FORMATS.flatMap((f) => PAGES.map((p) => [t.id, f, p] as const)));
  it.each(cases)("%s on %s at %i pages: texts stay inside the safe area and fit, and read clearly", (id, format, pages) => {
    const tpl = COVER_TEMPLATES.find((t) => t.id === id)!;
    const g = coverGeometry(trimById(format)!, pages, "white");
    const design = tpl.build(info, g);
    const styler = new Styler(fonts, "en");
    const { findings } = renderDesign(design, { geometry: g, images: new Map(), styler }, new Painter(styler, [0, 0, 0]));
    expect(findings.filter((f) => f.severity !== "info").map((f) => f.message)).toEqual([]);
    for (const l of design.layers) {
      if (l.kind !== "text" || !l.text.trim()) continue;
      for (const c of under(design, l, g)) expect(contrastRatio(hexToRgb(l.color), hexToRgb(c)), `${l.id} on ${c}`).toBeGreaterThanOrEqual(4.5);
    }
    // The design survives being saved and read back.
    const back = parseCoverDesign(JSON.parse(serializeCoverDesign(design)));
    expect(back.problems).toEqual([]);
    expect(serializeCoverDesign(back.design)).toBe(serializeCoverDesign(design));
  });

  it("leave the spine empty on a short book", () => {
    const g = coverGeometry(trimById("6x9")!, 60, "white");
    for (const t of COVER_TEMPLATES) expect(t.build(info, g).layers.filter((l) => l.panel === "spine")).toEqual([]);
  });

  it("use the book's own picture when they are picture templates", () => {
    const g = coverGeometry(trimById("6x9")!, 300, "white");
    for (const id of ["picture-band", "picture-card"]) {
      const d = COVER_TEMPLATES.find((t) => t.id === id)!.build({ ...info, coverTarget: "cover.jpg", coverAlt: "Cover" }, g);
      const img = d.layers.find((l) => l.kind === "image");
      expect(img && img.kind === "image" && img.target).toBe("cover.jpg");
      expect(COVER_TEMPLATES.find((t) => t.id === id)!.build(info, g).layers.some((l) => l.kind === "image")).toBe(false);
    }
  });
});

describe("generative backgrounds", () => {
  const box = { x: 0, y: 0, w: 930, h: 666 };
  const palette = ["#1a2a4d", "#223a69", "#16233f"];

  it.each(GEN_FAMILIES)("%s draws the same picture for the same seed and another for another", (family) => {
    const a = generativeDraws(family, "Title|Author|1", palette, box);
    expect(a.length).toBeGreaterThan(3);
    expect(JSON.stringify(generativeDraws(family, "Title|Author|1", palette, box))).toBe(JSON.stringify(a));
    expect(JSON.stringify(generativeDraws(family, "Title|Author|2", palette, box))).not.toBe(JSON.stringify(a));
    for (const d of a) {
      if (d.kind === "rect") expect([d.x, d.y, d.w, d.h].every(Number.isFinite)).toBe(true);
      if (d.kind === "path") expect(d.ops.flatMap((o) => (o.slice(1) as number[])).every((n) => typeof n === "number" && Number.isFinite(n))).toBe(true);
      // Only the colours it was given.
      const fills = [d.kind === "rect" || d.kind === "path" ? d.fill : undefined].filter(Boolean);
      for (const f of fills) expect(palette.map(hexToRgb).some((c) => c.every((v, i) => Math.abs(v - f![i]) < 1e-9))).toBe(true);
    }
  });

  it("the generator is repeatable and spread over 0 to 1", () => {
    const r1 = rng("x");
    const r2 = rng("x");
    const xs = Array.from({ length: 200 }, () => r1());
    expect(xs).toEqual(Array.from({ length: 200 }, () => r2()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.8);
  });
});
