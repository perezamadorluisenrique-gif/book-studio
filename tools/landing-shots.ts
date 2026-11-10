/// <reference types="node" />
// Makes the pictures on the landing pages (site/img/landing-*.webp) from the real engine and the real app:
//
//   - "Word" and "Book Studio" versions of the same passage: the same book, the same font, set by the same engine,
//     once the way a word processor sets it (greedy lines, no hyphens, no microtypography, a plain page) and once by Book Studio.
//   - Screenshots of the app for the three steps (needs `npm run build:web` first).
//
// `npm run landing-shots` writes everything; `-- --pages` or `-- --app` does only that part.
// Needs `pdftoppm` (poppler) and a Chromium (E2E_CHROMIUM, or Playwright's own).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { buildBook, exportPdf } from "../src/app/pipeline";
import { FontSet } from "../src/engine/fonts";
import { LayoutCache } from "../src/engine/layout/index";
import type { Layout, LayoutPage } from "../src/engine/layout/types";
import { isManifestFrontmatter } from "../src/engine/manifest";
import { splitFrontmatter } from "../src/engine/markdown";
import { fsVault } from "../tests/helpers/fsVault";
import { serve } from "../e2e/serve";

const OUT = "site/img";
const say = (line: string): void => void process.stdout.write(`${line}\n`);
const args = process.argv.slice(2);
const only = args.includes("--pages") ? "pages" : args.includes("--app") ? "app" : "all";

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });

/** PNG bytes to WebP bytes, through the browser's own encoder. */
async function toWebp(png: Buffer, quality = 0.82): Promise<Buffer> {
  const page = await browser.newPage();
  const b64 = await page.evaluate(
    async ([data, q]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      return c.toDataURL("image/webp", q).split(",")[1];
    },
    [png.toString("base64"), quality] as const,
  );
  await page.close();
  return Buffer.from(b64, "base64");
}

function save(name: string, data: Buffer): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), data);
  say(`  ${join(OUT, name)} (${(data.length / 1024).toFixed(1)} KB)`);
}

// ── Before and after ──

/** The lines of a full page of running text that start a paragraph, with their row on the page and first characters. */
function bodyLines(page: LayoutPage): { key: string; row: number }[] {
  if (page.role !== "body" || (page.stats?.short ?? 0) > 0) return [];
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const d of page.draws) if (d.kind === "text") rows.set(d.y, [...(rows.get(d.y) ?? []), { x: d.x, text: d.text }]);
  const lines = [...rows.entries()].sort((p, q) => p[0] - q[0]).map(([, words]) => words.sort((p, q) => p.x - q.x));
  if (lines.length < 26) return [];
  const left = Math.min(...lines.map((l) => l[0].x));
  const out: { key: string; row: number }[] = [];
  lines.forEach((l, row) => {
    const text = l.map((w) => w.text).join(" ");
    if (l[0].x > left + 6 && text.length > 20) out.push({ key: text.slice(0, 18), row });
  });
  return out;
}

/** A paragraph that starts near the top of a full page in both layouts, from 35 % into the book. */
function matchingPages(a: Layout, b: Layout): [number, number] {
  const starts = (l: Layout) => {
    const m = new Map<string, number>();
    l.pages.forEach((p, i) => {
      if (i < l.pages.length * 0.35) return;
      for (const line of bodyLines(p)) if (line.row >= 2 && line.row <= 14 && !m.has(line.key)) m.set(line.key, i);
    });
    return m;
  };
  const sb = starts(b);
  for (const [key, i] of starts(a)) {
    const j = sb.get(key);
    if (j !== undefined) return [i, j];
  }
  throw new Error("No paragraph starts near the top of a full page in both layouts");
}

async function pages(): Promise<void> {
  const fonts = await FontSet.load(async (f) => new Uint8Array(readFileSync(new URL(`../fonts/${f}.ttf`, import.meta.url))));
  const work = mkdtempSync(join(tmpdir(), "bs-shots-"));
  for (const [lang, dir] of [["es", "sample/leyendas"], ["en", "sample/oz"]] as const) {
    const vault = fsVault(dir);
    const manifest = vault.paths.find((p) => p.endsWith(".md") && isManifestFrontmatter(splitFrontmatter(readFileSync(join(dir, p), "utf8")).frontmatter))!;
    const studio = await buildBook(vault, manifest, fonts);
    const plain = await buildBook(vault, manifest, fonts, {}, { cache: new LayoutCache(true) });
    const [si, pi] = matchingPages(studio.layout, plain.layout);
    say(`${lang}: Book Studio page ${si + 1} of ${studio.layout.pages.length}, plain page ${pi + 1} of ${plain.layout.pages.length}`);
    for (const [name, built, index] of [["studio", studio, si], ["word", plain, pi]] as const) {
      const pdf = join(work, `${lang}-${name}.pdf`);
      writeFileSync(pdf, (await exportPdf(built, fonts)).data);
      const prefix = join(work, `${lang}-${name}`);
      execFileSync("pdftoppm", ["-png", "-r", "100", "-f", String(index + 1), "-l", String(index + 1), "-singlefile", pdf, prefix]);
      save(`landing-${lang}-${name}.webp`, await toWebp(readFileSync(`${prefix}.png`), 0.75));
    }
  }
}

// ── The app ──

async function shoot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  save(name, await toWebp(await page.screenshot({ type: "png", clip }), 0.8));
}

async function app(): Promise<void> {
  const { server, url } = await serve("dist/web");
  try {
    for (const [lang, locale, sample] of [["es", "es-ES", "leyendas"], ["en", "en-US", "oz"]] as const) {
      const context = await browser.newContext({ locale, viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      // 1. The first screen: nothing saved yet, drop a Word file here.
      await page.goto(url);
      await page.locator(".land-drop").waitFor();
      await shoot(page, `landing-${lang}-step1.webp`);
      // 2. The book with its style.
      await page.goto(`${url}?sample=${sample}`);
      await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
      await page.locator(".bs-page").nth(22).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      await shoot(page, `landing-${lang}-step2.webp`);
      // 3. The downloads: the bar with the export buttons (the pages say 1100 × 220).
      await shoot(page, `landing-${lang}-step3.webp`, { x: 0, y: 108, width: 1100, height: 220 });
      await context.close();
    }
  } finally {
    server.close();
  }
}

try {
  if (only !== "app") await pages();
  if (only !== "pages") await app();
} finally {
  await browser.close();
}
