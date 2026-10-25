import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import { layoutBook, type Layout } from "../src/engine/layout/index";
import type { BookSettings } from "../src/engine/model";
import { kdpMinInside, KDP_MIN_PAGES } from "../src/engine/trims";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";
import { memVault } from "./helpers/memVault";

const OZ = "The Wonderful Wizard of Oz.md";
let fonts: FontSet;
const oz = fsVault(new URL("../sample/oz", import.meta.url).pathname);
const layoutOz = async (overrides: Partial<BookSettings> = {}) => layoutBook(await loadBook(oz, OZ, overrides), fonts);

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
    const layout = layoutBook(await loadBook(vault, "Book.md"), fonts);
    expect(layout.pages.length).toBe(KDP_MIN_PAGES);
    expect(layout.warnings.map((w) => w.message).join(" ")).toMatch(/at least 24 pages/);
  });

  it("puts bleed on the outside edge only when asked", async () => {
    const layout = await layoutOz({ bleed: true });
    expect(layout.bleedPt).toBe(9);
    expect(layout.margins.outside).toBeGreaterThanOrEqual(0.375 * 72);
  });
});
