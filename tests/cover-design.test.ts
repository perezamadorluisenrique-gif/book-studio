/// <reference types="node" />
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook } from "../src/app/pipeline";
import { composeCover } from "../src/engine/cover/cover";
import { parseCoverDesign, serializeCoverDesign, type CoverDesign } from "../src/engine/cover/design";
import { coverGeometry } from "../src/engine/cover/geometry";
import { layerBox, safeBox } from "../src/engine/cover/render-design";
import type { FontSet } from "../src/engine/fonts";
import type { TextDraw } from "../src/engine/layout/types";
import { trimById } from "../src/engine/trims";
import { projectToVault } from "../src/project/to-vault";
import { vaultToProjects } from "../src/project/from-vault";
import type { Project } from "../src/project/model";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const design: CoverDesign = {
  version: 1,
  template: "test",
  background: { kind: "color", color: "#1f2a44" },
  layers: [
    { id: "title", kind: "text", panel: "front", x: 0.1, y: 0.2, w: 0.8, h: 0.3, text: "The Lighthouse Keeper", family: "eb-garamond", size: 40, minSize: 20, color: "#ffffff", align: "center", valign: "middle" },
    { id: "band", kind: "rect", panel: "front", x: 0, y: 0.9, w: 1, h: 0.1, color: "#c9a227", bleed: true },
    { id: "spine", kind: "text", panel: "spine", x: 0.2, y: 0.1, w: 0.6, h: 0.8, text: "The Lighthouse Keeper", family: "eb-garamond", size: 20, minSize: 8, color: "#ffffff", align: "center", valign: "middle", rotate: true },
    { id: "blurb", kind: "text", panel: "back", x: 0.1, y: 0.1, w: 0.8, h: 0.3, text: "A keeper, a storm, a secret.", family: "eb-garamond", size: 12, color: "#ffffff", align: "left", valign: "top" },
  ],
};

function vault(withDesign: boolean, chapters = 120) {
  const names = Array.from({ length: chapters }, (_, i) => `Ch${i + 1}`);
  const fm = ["book: true", "title: The Lighthouse Keeper", "author: Jane Doe", ...(withDesign ? ["cover-design: Cover design.json"] : [])];
  return memVault({
    "Book.md": `---\n${fm.join("\n")}\n---\n## Chapters\n${names.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(names.map((n, i) => [`${n}.md`, `# Chapter ${i + 1}\n\n${"A line of the story that goes on for a while, as stories do. ".repeat(60)}\n`])),
    ...(withDesign ? { "Cover design.json": serializeCoverDesign(design) } : {}),
  });
}

describe("parseCoverDesign", () => {
  it("round-trips a design through its text", () => {
    const parsed = parseCoverDesign(JSON.parse(serializeCoverDesign(design)));
    expect(parsed.problems).toEqual([]);
    expect(parsed.design.layers.map((l) => l.id)).toEqual(["title", "band", "spine", "blurb"]);
    expect(serializeCoverDesign(parsed.design)).toBe(serializeCoverDesign(design));
  });

  it("drops what it cannot use and puts numbers and colours in range", () => {
    const { design: d, problems } = parseCoverDesign({ version: 1, background: { kind: "color", color: "red" }, layers: [{ kind: "text", panel: "front", x: 9, w: -3, text: "Hi", size: 9999, color: "nope" }, { kind: "banana", panel: "front" }, { kind: "image", panel: "back" }, 7] });
    expect(d.background).toEqual({ kind: "color", color: "#ffffff" });
    expect(d.layers).toHaveLength(1);
    const t = d.layers[0];
    expect(t.kind === "text" && t.size).toBe(200);
    expect(t.x).toBe(1.5);
    expect(t.w).toBe(0.01);
    expect(t.kind === "text" && t.color).toBe("#111111");
    expect(problems).toHaveLength(3);
  });

  it("copes with things that are not a design at all", () => {
    for (const bad of [null, 5, "x", []]) expect(parseCoverDesign(bad).design.layers).toEqual([]);
  });
});

describe("layer boxes", () => {
  const g = coverGeometry(trimById("6x9")!, 300, "white");
  it("place a layer by fractions of its panel", () => {
    const b = layerBox(g, { panel: "front", x: 0.5, y: 0.25, w: 0.25, h: 0.5 });
    expect(b.x).toBeCloseTo(g.front.x + g.front.w / 2, 9);
    expect(b.w).toBeCloseTo(g.front.w / 4, 9);
    expect(b.h).toBeCloseTo(g.front.h / 2, 9);
  });
  it("run into the bleed only on the sides that touch the sheet's edge", () => {
    const b = layerBox(g, { panel: "front", x: 0, y: 0, w: 1, h: 1, bleed: true });
    expect(b.y).toBe(0);
    expect(b.y + b.h).toBeCloseTo(g.height, 9);
    expect(b.x).toBeCloseTo(g.front.x, 9);
    expect(b.x + b.w).toBeCloseTo(g.width, 9);
  });
  it("keep the spine's safe area off its folds", () => {
    const s = safeBox(g, "spine");
    expect(s.x - g.spineBox.x).toBeCloseTo(0.0625, 9);
    expect(g.spineBox.w - s.w).toBeCloseTo(0.125, 9);
  });
});

describe("composeCover with a layered design", () => {
  it("reads the design from the vault and draws its layers instead of the typeset cover", async () => {
    const built = await buildBook(vault(true), "Book.md", fonts);
    expect(built.book.meta.coverLayout?.layers).toHaveLength(4);
    const c = composeCover(built.book, fonts, built.layout.pages.length);
    const draws = c.layout.pages[0].draws;
    const text = draws.filter((d): d is TextDraw => d.kind === "text");
    expect(text.map((d) => d.text).join(" ")).toContain("secret");
    // The typeset cover would print the author; this design doesn't.
    expect(text.map((d) => d.text).join(" ")).not.toContain("Jane");
    // The first rect is the background colour of the whole sheet.
    expect(draws[0]).toMatchObject({ kind: "rect", x: 0, y: 0, fill: [0x1f / 255, 0x2a / 255, 0x44 / 255] });
    // The band runs to the sheet's right and bottom edges.
    const band = draws.find((d) => d.kind === "rect" && d.fill && d.fill[0] > 0.7 && d.fill[2] < 0.3);
    expect(band && band.kind === "rect" && band.x + band.w).toBeCloseTo(c.geometry.width * 72, 6);
    expect(band && band.kind === "rect" && band.y + band.h).toBeCloseTo(c.geometry.height * 72, 6);
    expect(c.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("turns the spine text and keeps it inside the safe width", async () => {
    const built = await buildBook(vault(true), "Book.md", fonts);
    const c = composeCover(built.book, fonts, built.layout.pages.length);
    const g = c.geometry;
    const rotated = c.layout.pages[0].draws.filter((d): d is TextDraw => d.kind === "text" && d.angle === -90);
    expect(rotated.map((d) => d.text).join("")).toContain("Lighthouse");
    for (const d of rotated) {
      expect(d.x).toBeGreaterThan((g.spineBox.x + 0.0625) * 72);
      expect(d.x).toBeLessThan((g.spineBox.x + g.spine - 0.0625) * 72);
    }
  });

  it("leaves spine layers out of short books and says why", async () => {
    const built = await buildBook(vault(true, 1), "Book.md", fonts);
    const c = composeCover(built.book, fonts, built.layout.pages.length);
    expect(c.geometry.spineText).toBe(false);
    expect(c.layout.pages[0].draws.some((d) => d.kind === "text" && d.angle)).toBe(false);
    expect(c.findings.some((f) => /No text on the spine/.test(f.message))).toBe(true);
  });

  it("warns about text outside the safe area, over the barcode, or too long for its box", async () => {
    const bad: CoverDesign = {
      ...design,
      layers: [
        { id: "edge", kind: "text", panel: "front", x: 0, y: 0, w: 1, h: 0.1, text: "Too close to the trim", family: "eb-garamond", size: 12, color: "#ffffff", align: "left", valign: "top" },
        { id: "bar", kind: "text", panel: "back", x: 0.2, y: 0.8, w: 0.7, h: 0.15, text: "Over the barcode", family: "eb-garamond", size: 12, color: "#ffffff", align: "left", valign: "top" },
        { id: "long", kind: "text", panel: "front", x: 0.1, y: 0.3, w: 0.8, h: 0.05, text: "word ".repeat(80), family: "eb-garamond", size: 14, color: "#ffffff", align: "left", valign: "top" },
      ],
    };
    const built = await buildBook(vault(true), "Book.md", fonts);
    built.book.meta.coverLayout = bad;
    const c = composeCover(built.book, fonts, built.layout.pages.length);
    const by = (id: string) => c.findings.filter((f) => (f as { layer?: string }).layer === id).map((f) => f.message);
    expect(by("edge").join()).toMatch(/safe area/);
    expect(by("bar").join()).toMatch(/barcode/);
    expect(by("long").join()).toMatch(/does not fit/);
  });

  it("keeps the typeset cover when there is no design", async () => {
    const built = await buildBook(vault(false), "Book.md", fonts);
    expect(built.book.meta.coverLayout).toBeUndefined();
    const text = composeCover(built.book, fonts, built.layout.pages.length).layout.pages[0].draws.filter((d): d is TextDraw => d.kind === "text").map((d) => d.text).join(" ");
    expect(text).toContain("Jane");
  });

  it("falls back to the typeset cover when the file is not JSON", async () => {
    const v = memVault({ "Book.md": "---\nbook: true\ntitle: T\nauthor: A\ncover-design: Cover design.json\n---\n## Chapters\n1. [[C]]\n", "C.md": "# C\n\ntext\n", "Cover design.json": "{ nope" });
    const built = await buildBook(v, "Book.md", fonts);
    expect(built.book.meta.coverLayout).toBeUndefined();
    expect(built.book.warnings.some((w) => /not valid JSON/.test(w.message))).toBe(true);
  });
});

describe("a project keeps its cover design", () => {
  const project: Project = { id: "p1", name: "Book", meta: { title: "Book", author: "A" }, settings: {}, sections: [{ kind: "body", chapterIds: ["c1"] }], chapters: [{ id: "c1", title: "One", body: "Hello." }], assets: [], updatedAt: 1, coverDesign: design };

  it("writes the design next to the book and reads it back", async () => {
    const vault = projectToVault(project);
    expect(vault.paths).toContain("Cover design.json");
    const book = await vault.read(vault.bookPath);
    expect(book).toContain("cover-design: Cover design.json");
    const files = {
      paths: vault.paths,
      text: (p: string) => vault.read(p),
      bytes: async (p: string) => new TextEncoder().encode(await vault.read(p)),
    };
    const back = await vaultToProjects(files, { now: 2, newId: () => "p2" });
    expect(back.projects[0].coverDesign && serializeCoverDesign(back.projects[0].coverDesign)).toBe(serializeCoverDesign(design));
    expect(back.projects[0].meta["cover-design"]).toBeUndefined();
  });

  it("writes nothing extra for a book without one", () => {
    const { coverDesign: _d, ...plain } = project;
    expect(projectToVault(plain).paths).not.toContain("Cover design.json");
  });
});
