import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportEpub } from "../src/app/pipeline";
import { loadBook } from "../src/engine/book";
import { FREE_THEMES } from "../src/engine/entitlements";
import type { FontSet } from "../src/engine/fonts";
import { loadHyphenator } from "../src/engine/hyphenate";
import { layoutBook } from "../src/engine/layout/index";
import { ORNAMENTS, ornamentById, parsePathData, scaleOps, toPathData } from "../src/engine/ornaments";
import { isVector, resolveTheme, THEMES, type Theme } from "../src/engine/themes";
import { DEFAULT_SETTINGS } from "../src/engine/model";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";
import { memVault } from "./helpers/memVault";

const NEW = ["literary", "minimal", "memoir", "textbook"];
let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

// Seven traits a reader sees: two styles of the free set must differ in at least three.
function traits(t: Theme): (string | number | boolean)[] {
  const c = t.chapter;
  return [
    t.body.family,
    c.title.family,
    c.title.align,
    `${c.label.show}/${c.label.format}/${c.label.prefix}`,
    `${t.firstParagraph.dropCap}/${t.firstParagraph.leadInWords}`,
    t.folio.position,
    t.body.blockParagraphs || t.body.indent === 0 ? "block" : "indent",
  ];
}

describe("free styles", () => {
  const all = FREE_THEMES.map((id) => THEMES.find((t) => t.id === id)!);

  it("has nine, and the four new ones are free", () => {
    expect(all.length).toBe(9);
    for (const id of NEW) expect(FREE_THEMES).toContain(id);
  });

  it("makes every pair differ in at least three of seven traits", () => {
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = traits(all[i]);
        const b = traits(all[j]);
        const diff = a.filter((v, k) => v !== b[k]).length;
        expect(diff, `${all[i].id} and ${all[j].id}`).toBeGreaterThanOrEqual(3);
      }
  });

  it("uses only the six families, and Cormorant only for titles", () => {
    for (const t of all) {
      expect(["eb-garamond", "crimson-pro", "atkinson"], t.id).toContain(t.body.family);
      if (NEW.includes(t.id)) for (const s of [t.runningHead, t.folio.style, t.heading3, t.chapter.label.style]) expect(s.family, t.id).not.toBe("cormorant");
    }
  });
});

describe("vector ornaments", () => {
  it("has eight, each a closed shape inside its 100 × 20 box", () => {
    expect(ORNAMENTS.length).toBe(8);
    for (const o of ORNAMENTS) {
      const ops = scaleOps(toPathData(o.ops), 100, 0, 0);
      const xs = ops.flatMap((p) => (p[0] === "Z" ? [] : p.slice(1).filter((_, k) => k % 2 === 0))) as number[];
      const ys = ops.flatMap((p) => (p[0] === "Z" ? [] : p.slice(1).filter((_, k) => k % 2 === 1))) as number[];
      expect(Math.min(...xs), o.id).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs), o.id).toBeLessThanOrEqual(100);
      expect(Math.min(...ys), o.id).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys), o.id).toBeLessThanOrEqual(20);
      expect(parsePathData(toPathData(o.ops)).length, o.id).toBe(o.ops.length);
    }
  });

  it("is picked with style.sceneBreak = ornament:<id>", () => {
    const t = resolveTheme({ ...DEFAULT_SETTINGS, style: { sceneBreak: "ornament:star" } });
    expect(isVector(t.sceneBreak) && t.sceneBreak.path).toBe(ornamentById("star", 48)!.path);
  });
});

describe("the four new styles lay out and export", () => {
  it("sets Oz in each without a blocking warning and draws their ornaments", async () => {
    const book = await loadBook(fsVault(new URL("../sample/oz", import.meta.url).pathname), "The Wonderful Wizard of Oz.md", {});
    const hyphenator = await loadHyphenator("en");
    for (const theme of NEW) {
      const layout = layoutBook({ ...book, settings: { ...book.settings, theme } }, fonts, { hyphenator });
      expect(layout.warnings.filter((w) => w.severity === "error"), theme).toEqual([]);
      expect(layout.pages.some((p) => p.draws.some((d) => d.kind === "path")), theme).toBe(true);
    }
  }, 60_000);

  it("writes the ornament into the EPUB as hidden inline SVG and declares it", async () => {
    const files = {
      "Book.md": "---\nbook: true\ntitle: T\nauthor: A\nlanguage: en\n---\n## Chapters\n1. [[One]]\n",
      "One.md": "# One\n\nFirst.\n\n* * *\n\nSecond.\n",
    };
    for (const theme of NEW) {
      const built = await buildBook(memVault(files), "Book.md", fonts, { theme });
      const zip = await JSZip.loadAsync((await exportEpub(built, fonts, "free", { claim: false })).data);
      const names = Object.keys(zip.files).filter((n) => /text\/.*\.xhtml$/.test(n));
      const text = (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("\n");
      expect(text, theme).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      for (const m of text.matchAll(/<svg [^>]*>/g)) expect(m[0], theme).toContain('aria-hidden="true"');
      expect(await zip.file("EPUB/package.opf")!.async("string"), theme).toContain('properties="svg"');
    }
  });
});
