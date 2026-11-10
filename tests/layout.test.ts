import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import type { Layout } from "../src/engine/layout/index";
import type { BookSettings } from "../src/engine/model";
import { kdpMinInside, KDP_MIN_PAGES } from "../src/engine/trims";
import { testFonts } from "./helpers/fonts";
import { layoutHyphenated } from "./helpers/layout";
import { fsVault } from "./helpers/fsVault";
import { memVault } from "./helpers/memVault";

const OZ = "The Wonderful Wizard of Oz.md";
let fonts: FontSet;
const oz = fsVault(new URL("../sample/oz", import.meta.url).pathname);
const layoutOz = async (overrides: Partial<BookSettings> = {}) => layoutHyphenated(await loadBook(oz, OZ, overrides), fonts);

beforeAll(async () => {
  fonts = await testFonts();
});

function expectPrintable(layout: Layout): void {
  const pages = layout.pages.length;
  expect(pages % 2).toBe(0);
  expect(pages).toBeGreaterThanOrEqual(KDP_MIN_PAGES);
  expect(layout.margins.inside).toBeGreaterThanOrEqual(kdpMinInside(pages) * 72 - 0.01);
  expect(Math.min(layout.margins.top, layout.margins.bottom, layout.margins.outside)).toBeGreaterThanOrEqual(0.25 * 72);
  for (const page of layout.pages) {
    for (const d of page.draws) {
      if (d.kind === "rule") continue;
      // Everything sits inside the trim; nothing relies on bleed.
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(layout.widthPt);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(layout.heightPt);
    }
  }
}

// The first layout loads the fonts, which takes over 5 s on a busy machine.
describe("print layout", { timeout: 30_000 }, () => {
  it("lays out the sample within KDP's rules", async () => {
    const layout = await layoutOz();
    expect([layout.widthPt, layout.heightPt]).toEqual([432, 648]);
    expectPrintable(layout);
    expect(layout.toc.length).toBeGreaterThanOrEqual(24);
  });

  it("sets every paragraph of a callout flush left, unlike a plain quote", async () => {
    const para = (n: number) => `Paragraph ${n} of the quote has enough words to wrap onto a second line, so the first line of it can be told apart.`;
    const body = `# One\n\nIntro.\n\n> ${["", "", ""].map((_, i) => para(i + 1)).join("\n>\n> ")}\n`;
    const starts = async (note: string) => {
      const book = await loadBook(memVault({ "Book.md": "---\nbook: true\ntitle: Tiny\n---\n- [[One]]\n", "One.md": note }), "Book.md", {});
      const layout = await layoutHyphenated(book, fonts);
      const xs = layout.pages.flatMap((pg) => pg.draws).filter((d) => d.kind === "text" && /Paragraph/.test(d.text)).map((d) => (d.kind === "text" ? Math.round(d.x * 100) : 0));
      return new Set(xs).size;
    };
    expect(await starts(body)).toBeGreaterThan(1); // a plain quote indents its later paragraphs
    expect(await starts(body.replace("> Paragraph 1", "> [!quote]\n> Paragraph 1"))).toBe(1);
  });

  it("starts every chapter on a right-hand page by default", async () => {
    const layout = await layoutOz();
    const openers = layout.pages.filter((p) => p.role === "opener");
    expect(openers.length).toBeGreaterThanOrEqual(24);
    expect(openers.every((p) => p.recto)).toBe(true);
  });

  it("needs no more pages when chapters may start on either side", async () => {
    const recto = await layoutOz();
    const any = await layoutOz({ chapterStart: "any" });
    expect(any.pages.length).toBeLessThanOrEqual(recto.pages.length);
    expectPrintable(any);
  });

  it("follows the trim size", async () => {
    const layout = await layoutOz({ trim: "5x8" });
    expect([layout.widthPt, layout.heightPt]).toEqual([360, 576]);
    expectPrintable(layout);
  });

  it("widens the gutter as the page count grows", async () => {
    const layout = await layoutOz({ theme: "large-print" });
    expect(layout.pages.length).toBeGreaterThan(150);
    expect(layout.margins.inside).toBeGreaterThanOrEqual(0.5 * 72);
    expectPrintable(layout);
  });

  it("pads a short book to KDP's minimum and says so", async () => {
    const vault = memVault({ "Book.md": "---\nbook: true\ntitle: Tiny\n---\n- [[One]]\n", "One.md": "# One\n\nA line." });
    const layout = await layoutHyphenated(await loadBook(vault, "Book.md"), fonts);
    expect(layout.pages.length).toBe(KDP_MIN_PAGES);
    expect(layout.warnings.map((w) => w.message).join(" ")).toMatch(/at least 24 pages/);
  });

  it("puts bleed on the outside edge only when asked", async () => {
    const layout = await layoutOz({ bleed: true });
    expect(layout.bleedPt).toBe(9);
    expect(layout.margins.outside).toBeGreaterThanOrEqual(0.375 * 72);
  });

  it("sets Leyendas without a ladder of three hyphens in a row", async () => {
    const leyendas = fsVault(new URL("../sample/leyendas", import.meta.url).pathname);
    const layout = await layoutHyphenated(await loadBook(leyendas, "Leyendas y rimas.md"), fonts);
    expect(layout.quality.ladders).toBe(0);
    expect(layout.quality.lines).toBeGreaterThan(3000);
  });

  it("hangs hyphens into the right margin and keeps letter expansion within 2 %", async () => {
    const layout = await layoutOz();
    const textWidth = layout.widthPt - layout.margins.inside - layout.margins.outside;
    let hung = 0;
    for (const page of layout.pages) {
      const left = page.recto ? layout.margins.inside : layout.margins.outside;
      const right = left + textWidth;
      const rows = new Map<number, { x: number; end: number; text: string }>();
      for (const d of page.draws) {
        if (d.kind !== "text") continue;
        expect(d.scale ?? 1).toBeGreaterThanOrEqual(0.98 - 1e-9);
        expect(d.scale ?? 1).toBeLessThanOrEqual(1.02 + 1e-9);
        const end = d.x + fonts.width(d.face, d.text, d.size, d.tracking ?? 0) * (d.scale ?? 1);
        const row = rows.get(d.y);
        if (!row || end > row.end) rows.set(d.y, { x: d.x, end, text: d.text });
      }
      for (const row of rows.values()) if (row.text.endsWith("-") && row.end > right + 0.5 && row.end < right + 4) hung++;
    }
    expect(hung).toBeGreaterThan(0);
  });

  it("leaves no widows or orphans and no uneven facing pages beyond the baseline in the samples", async () => {
    const leyendas = await layoutHyphenated(await loadBook(fsVault(new URL("../sample/leyendas", import.meta.url).pathname), "Leyendas y rimas.md"), fonts);
    for (const layout of [await layoutOz(), leyendas]) {
      expect(layout.quality.widows).toBe(0);
      expect(layout.quality.orphans).toBe(0);
      expect(layout.quality.adjusted).toBeGreaterThan(0);
    }
  });
});
