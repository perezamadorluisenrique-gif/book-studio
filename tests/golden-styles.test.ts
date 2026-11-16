import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import { loadHyphenator } from "../src/engine/hyphenate";
import { layoutBook, type Layout } from "../src/engine/layout/index";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";

// Three pages of Oz in each style added in T5: a chapter opening, an ordinary facing pair's left page and a page
// with a scene break. Text, drawn paths and positions (rounded to 0.1 pt) as plain text.
// Regenerate with `npx vitest run tests/golden-styles.test.ts -u` only when a change moves things on purpose.
let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

function describePage(layout: Layout, index: number): string {
  const page = layout.pages[index];
  const lines = [`page ${index} (folio ${page.folio})`];
  for (const d of page.draws) {
    if (d.kind === "text") lines.push(`${d.x.toFixed(1)} ${d.y.toFixed(1)} ${d.size.toFixed(1)} ${d.text}`);
    if (d.kind === "path") lines.push(`path ${d.ops.length} ops from ${d.ops[0].slice(1).map((n) => (n as number).toFixed(1)).join(" ")}`);
  }
  return lines.join("\n");
}

describe("golden pages of the T5 styles", { timeout: 60_000 }, () => {
  for (const theme of ["literary", "minimal", "memoir", "textbook"]) {
    it(`${theme}: opening, ordinary page and scene break`, async () => {
      const book = await loadBook(fsVault(new URL("../sample/oz", import.meta.url).pathname), "The Wonderful Wizard of Oz.md", {});
      const layout = layoutBook({ ...book, settings: { ...book.settings, theme } }, fonts, { hyphenator: await loadHyphenator("en") });
      const opener = layout.pages.findIndex((p, i) => i >= layout.bodyStart && p.role === "opener");
      const ordinary = opener + 2;
      // Oz's only scene break is in the closing note, so the last page that draws a path is the one.
      const scene = layout.pages.map((p) => p.draws.some((d) => d.kind === "path")).lastIndexOf(true);
      expect(opener).toBeGreaterThan(0);
      expect(scene).toBeGreaterThan(0);
      const text = [opener, ordinary, scene].map((i) => describePage(layout, i)).join("\n\n") + "\n";
      await expect(text).toMatchFileSnapshot(`./golden/style-${theme}.txt`);
    });
  }
});
