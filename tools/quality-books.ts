/// <reference types="node" />
// The books the typographic quality bench sets, and how it measures them.
// Shared by `npm run quality` and tests/quality.test.ts so both see the same numbers.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import { loadHyphenator } from "../src/engine/hyphenate";
import { layoutBook } from "../src/engine/layout/index";
import type { BookSettings } from "../src/engine/model";
import { FREE_THEMES } from "../src/engine/entitlements";
import type { Layout, Quality } from "../src/engine/layout/types";
import { isManifestFrontmatter } from "../src/engine/manifest";
import { splitFrontmatter } from "../src/engine/markdown";
import { fsVault } from "../tests/helpers/fsVault";

export const BENCH_BOOKS = ["sample/oz", "sample/leyendas", "tests/fixtures/books/dialogo-es", "tests/fixtures/books/ensayo-es", "tests/fixtures/books/largo-de"] as const;

/** The counts a change must never make worse, and the order they print in. */
export const DEFECTS = ["shortPages", "unevenSpreads", "ladders", "veryLoose", "loose", "widows", "orphans", "hyphenTurns"] as const;
export type Defect = (typeof DEFECTS)[number];

export interface BenchResult {
  book: string;
  pages: number;
  quality: Quality;
  ms: number;
}

export async function measureBook(root: string, dir: string, fonts: FontSet, overrides: Partial<BookSettings> = {}): Promise<BenchResult> {
  const abs = join(root, dir);
  const vault = fsVault(abs);
  const manifest = vault.paths.find((p) => p.endsWith(".md") && isManifestFrontmatter(splitFrontmatter(readFileSync(join(abs, p), "utf8")).frontmatter));
  if (!manifest) throw new Error(`No book found in ${dir}`);
  const book = await loadBook(vault, manifest, overrides);
  const hyphenator = await loadHyphenator(book.meta.language);
  const t0 = performance.now();
  const layout: Layout = layoutBook(book, fonts, { hyphenator });
  const ms = Math.round(performance.now() - t0);
  return { book: dir.replace(/^.*\//, ""), pages: layout.pages.length, quality: layout.quality, ms };
}

export async function measureAll(root: string, fonts: FontSet): Promise<BenchResult[]> {
  const out: BenchResult[] = [];
  for (const dir of BENCH_BOOKS) out.push(await measureBook(root, dir, fonts));
  return out;
}

/** What goes in tests/quality-baseline.json: the defect counts per book, nothing that varies from run to run. */
export function baselineOf(results: BenchResult[]): Record<string, Record<Defect, number> & { pages: number }> {
  const out: Record<string, Record<Defect, number> & { pages: number }> = {};
  for (const r of results) {
    const row = { pages: r.pages } as Record<Defect, number> & { pages: number };
    for (const d of DEFECTS) row[d] = r.quality[d];
    out[r.book] = row;
  }
  return out;
}

/** The books the per-style table sets, each in every free style. */
export const STYLE_BOOKS = ["sample/oz", "tests/fixtures/books/ensayo-es"] as const;

export interface StyleResult extends BenchResult {
  style: string;
}

export async function measureStyles(root: string, fonts: FontSet): Promise<StyleResult[]> {
  const out: StyleResult[] = [];
  for (const dir of STYLE_BOOKS) for (const style of FREE_THEMES) out.push({ ...(await measureBook(root, dir, fonts, { theme: style })), style });
  return out;
}

/** The styles part of tests/quality-baseline.json, under "by-style": book, then style. */
export function styleBaselineOf(results: StyleResult[]): Record<string, Record<string, Record<Defect, number> & { pages: number }>> {
  const out: Record<string, Record<string, Record<Defect, number> & { pages: number }>> = {};
  for (const r of results) {
    const row = { pages: r.pages } as Record<Defect, number> & { pages: number };
    for (const d of DEFECTS) row[d] = r.quality[d];
    (out[r.book] ??= {})[r.style] = row;
  }
  return out;
}
