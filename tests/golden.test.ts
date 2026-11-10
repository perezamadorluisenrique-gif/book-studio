import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import { layoutBook, type Layout } from "../src/engine/layout/index";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";

// Golden pages: the text and the positions (rounded to 0.1 pt) of six fixed pages of each sample
// book, as plain text so they don't depend on the system. A change that moves lines on purpose
// regenerates them with `npx vitest run tests/golden.test.ts -u`; say so in the PR.
const PAGES = [30, 31, 60, 61, 100, 101];
const BOOKS = [
  { name: "oz", dir: "../sample/oz", manifest: "The Wonderful Wizard of Oz.md" },
  { name: "leyendas", dir: "../sample/leyendas", manifest: "Leyendas y rimas.md" },
];
let fonts: FontSet;

beforeAll(async () => {
  fonts = await testFonts();
});

function describePage(layout: Layout, index: number): string {
  const page = layout.pages[index];
  const lines = [`page ${index} (folio ${page.folio})`];
  for (const d of page.draws) {
    if (d.kind === "text") lines.push(`${d.x.toFixed(1)} ${d.y.toFixed(1)} ${d.size.toFixed(1)} ${d.text}`);
  }
  return lines.join("\n");
}

describe("golden pages", { timeout: 60_000 }, () => {
  for (const b of BOOKS) {
    it(`${b.name}: six fixed pages keep their text and positions`, async () => {
      const book = await loadBook(fsVault(new URL(b.dir, import.meta.url).pathname), b.manifest, {});
      const layout = layoutBook(book, fonts);
      const text = PAGES.map((p) => describePage(layout, p)).join("\n\n") + "\n";
      await expect(text).toMatchFileSnapshot(`./golden/${b.name}.txt`);
      expect(text.split("\n").length).toBeGreaterThan(100);
    });
  }
});
