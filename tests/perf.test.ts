import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import { loadHyphenator, type Hyphenator } from "../src/engine/hyphenate";
import { layoutBook, LayoutCache } from "../src/engine/layout/index";
import { isManifestFrontmatter } from "../src/engine/manifest";
import { splitFrontmatter } from "../src/engine/markdown";
import type { Book } from "../src/engine/model";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";

// The cache that keeps words and chapters between layouts must change how long a layout takes, never what it
// makes. And a book of 300 pages must lay out in a few seconds, with a quick second layout after one edit.

const root = new URL("..", import.meta.url).pathname;

async function sample(dir: string): Promise<Book> {
  const abs = join(root, dir);
  const vault = fsVault(abs);
  const manifest = vault.paths.find((p) => p.endsWith(".md") && isManifestFrontmatter(splitFrontmatter(readFileSync(join(abs, p), "utf8")).frontmatter));
  if (!manifest) throw new Error(`No book in ${dir}`);
  return loadBook(vault, manifest, {});
}

let fonts: FontSet;
let hyphenator: Hyphenator | null;
let leyendas: Book;

beforeAll(async () => {
  fonts = await testFonts();
  leyendas = await sample("sample/leyendas");
  hyphenator = await loadHyphenator(leyendas.meta.language);
}, 60_000);

const shape = (l: ReturnType<typeof layoutBook>) => JSON.stringify({ pages: l.pages, toc: l.toc, warnings: l.warnings, quality: l.quality, margins: l.margins });

describe("layout cache", () => {
  it("gives the same pages with a cold cache, a warm one and none passed", () => {
    const plain = shape(layoutBook(leyendas, fonts, { hyphenator }));
    const cache = new LayoutCache();
    expect(shape(layoutBook(leyendas, fonts, { hyphenator, cache }))).toBe(plain);
    expect(shape(layoutBook(leyendas, fonts, { hyphenator, cache }))).toBe(plain);
  });

  it("does not reuse a chapter when the settings, the language or the hyphenation change", () => {
    const cache = new LayoutCache();
    layoutBook(leyendas, fonts, { hyphenator, cache });
    for (const change of [{ fontSize: 12 }, { trim: "5x8" }, { hyphenate: false }, { theme: "modern" }]) {
      const book: Book = { ...leyendas, settings: { ...leyendas.settings, ...change } };
      const fresh = layoutBook(book, fonts, { hyphenator: book.settings.hyphenate ? hyphenator : null });
      const warm = layoutBook(book, fonts, { hyphenator: book.settings.hyphenate ? hyphenator : null, cache });
      expect(shape(warm), JSON.stringify(change)).toBe(shape(fresh));
    }
    const noHyphens = layoutBook(leyendas, fonts, { hyphenator: null, cache });
    expect(shape(noHyphens)).toBe(shape(layoutBook(leyendas, fonts, { hyphenator: null })));
  }, 60_000);

  it("sets again only the chapter that changed, and gets it right", () => {
    const cache = new LayoutCache();
    layoutBook(leyendas, fonts, { hyphenator, cache });
    const at = Math.floor(leyendas.chapters.length / 2);
    const edited: Book = {
      ...leyendas,
      chapters: leyendas.chapters.map((c, i) =>
        i !== at
          ? c
          : {
              ...c,
              blocks: c.blocks.map((b, k) => (b.kind === "paragraph" && k === c.blocks.findIndex((x) => x.kind === "paragraph") ? { ...b, inlines: [...b.inlines, { kind: "text" as const, text: " Una frase añadida para el ensayo.", style: {} }] } : b)),
            },
      ),
    };
    expect(shape(layoutBook(edited, fonts, { hyphenator, cache }))).toBe(shape(layoutBook(edited, fonts, { hyphenator })));
  });
});

describe("speed of a long book", () => {
  it("lays out 300 pages in a few seconds, and an edit is quick", () => {
    const tripled: Book = { ...leyendas, chapters: [0, 1, 2].flatMap((k) => leyendas.chapters.map((c) => ({ ...c, id: `${c.id}-copy${k}`, title: c.title }))) };
    const cache = new LayoutCache();
    const t0 = performance.now();
    const first = layoutBook(tripled, fonts, { hyphenator, cache });
    const firstMs = performance.now() - t0;
    expect(first.pages.length).toBeGreaterThan(300);
    expect(firstMs).toBeLessThan(3000);

    const at = Math.floor(tripled.chapters.length / 2);
    const edited: Book = {
      ...tripled,
      chapters: tripled.chapters.map((c, i) =>
        i !== at ? c : { ...c, blocks: c.blocks.map((b, k) => (b.kind === "paragraph" && k === c.blocks.findIndex((x) => x.kind === "paragraph") ? { ...b, inlines: [...b.inlines, { kind: "text" as const, text: " Otra frase.", style: {} }] } : b)) },
      ),
    };
    const t1 = performance.now();
    layoutBook(edited, fonts, { hyphenator, cache });
    const editMs = performance.now() - t1;
    expect(editMs).toBeLessThan(firstMs / 3);
  }, 60_000);
});
