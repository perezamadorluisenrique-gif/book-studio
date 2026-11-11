/// <reference types="node" />
// The free KDP tools: their numbers against KDP's own worked examples and against the engine that lays out
// the books, the template PDF, and the barcode read back by a decoder that knows only the GS1 standard.

import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { barcodeSvg, MODULES, QUIET } from "../site/tools/src/barcode";
import { coverPixels, coverSize, FIGURES, INKS, insideMargin, margins, minListPrice, pagesProblem, printingCost, round, royalty, royaltyRate, spineHasText, spineWidth, TRIM_SPECS, trimSpec, wordsToPages } from "../site/tools/src/kdp";
import { appLink, query } from "../site/tools/src/links";
import { templatePdf } from "../site/tools/src/pdf";
import { coverTemplate } from "../site/tools/src/template";
import { coverGeometry, SPINE_PER_PAGE } from "../src/engine/cover/geometry";
import { checkIsbn } from "../src/engine/cover/isbn";
import { startSettings } from "../src/project/start-link";
import { KDP_MAX_PAGES, KDP_MIN_PAGES, kdpMinInside, kdpMinOutside, TRIMS } from "../src/engine/trims";

const DAY = 86_400_000;

describe("the figures fixture", () => {
  it("carries the date it was read from KDP and the pages it came from, and is not older than 180 days", () => {
    expect(FIGURES.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const age = (Date.now() - Date.parse(FIGURES.checked)) / DAY;
    expect(age, `the KDP figures were checked on ${FIGURES.checked}: read the four source pages again and update tools/data/kdp-figures.json`).toBeLessThan(180);
    for (const url of Object.values(FIGURES.sources)) expect(url).toMatch(/^https:\/\/kdp\.amazon\.com\/en_US\/help\/topic\/[A-Z0-9]+$/);
  });

  it("lists KDP's 16 paperback sizes", () => {
    expect(TRIM_SPECS).toHaveLength(16);
    expect(trimSpec("8.5x11")?.pages.bw_white).toEqual([24, 590]);
    expect(trimSpec("8.27x11.69")?.pages.color_standard).toBeNull();
    expect(trimSpec("5x8")?.pages.color_standard).toEqual([72, 600]);
  });
});

describe("spine and cover, against KDP's formula", () => {
  it("gives KDP's own thickness per page", () => {
    expect(spineWidth(1000, "bw_white")).toBeCloseTo(2.252, 6);
    expect(spineWidth(1000, "bw_cream")).toBeCloseTo(2.5, 6);
    expect(spineWidth(1000, "color_premium")).toBeCloseTo(2.347, 6);
    expect(spineWidth(1000, "color_standard")).toBeCloseTo(2.252, 6);
    expect(round(spineWidth(300, "bw_white"), 4)).toBe(0.6756);
  });

  it("allows spine text from 79 pages", () => {
    expect(spineHasText(78)).toBe(false);
    expect(spineHasText(79)).toBe(true);
  });

  it("adds the bleed to the width twice and to the height twice", () => {
    const c = coverSize({ width: 6, height: 9 }, 300, "bw_white");
    expect(round(c.width, 4)).toBe(12.9256);
    expect(c.height).toBe(9.25);
    expect(coverPixels(c)).toEqual({ width: 3878, height: 2775 });
  });

  it("matches the engine that lays out the books, for every size the app supports", () => {
    expect(FIGURES.bleed).toBe(0.125);
    const paper = { bw_white: "white", bw_cream: "cream", color_premium: "color" } as const;
    for (const [ink, p] of Object.entries(paper)) expect(FIGURES.spinePerPage[ink as keyof typeof paper], ink).toBe(SPINE_PER_PAGE[p]);
    for (const t of TRIMS) {
      const spec = trimSpec(t.id);
      expect(spec, t.id).toBeDefined();
      for (const [ink, p] of Object.entries(paper)) {
        const mine = coverSize(spec!, 250, ink as keyof typeof paper);
        const theirs = coverGeometry(t, 250, p);
        expect(mine.width).toBeCloseTo(theirs.width, 9);
        expect(mine.height).toBeCloseTo(theirs.height, 9);
        expect(mine.spine).toBeCloseTo(theirs.spine, 9);
      }
    }
  });
});

describe("margins, against the engine", () => {
  it("gives the engine's inside margin for every page count KDP prints", () => {
    for (let p = KDP_MIN_PAGES; p <= KDP_MAX_PAGES; p++) expect(insideMargin(p), String(p)).toBe(kdpMinInside(p));
    expect(insideMargin(23)).toBeNull();
    expect(FIGURES.margins.outsideNoBleed).toBe(kdpMinOutside(false));
    expect(FIGURES.margins.outsideBleed).toBe(kdpMinOutside(true));
  });

  it("exports 6.125 × 9.25 in for a 6 × 9 in book with bleed, and the trim size without", () => {
    const m = margins({ width: 6, height: 9 }, 300, true)!;
    expect([m.pageWidth, m.pageHeight, m.inside, m.outside]).toEqual([6.125, 9.25, 0.5, 0.375]);
    const n = margins({ width: 6, height: 9 }, 120, false)!;
    expect([n.pageWidth, n.pageHeight, n.inside, n.outside]).toEqual([6, 9, 0.375, 0.25]);
    expect(margins({ width: 6, height: 9 }, 900, false)).toBeNull();
  });

  it("checks page counts against each size and ink", () => {
    const t = trimSpec("6x9")!;
    expect(pagesProblem(t, "bw_white", 300)).toBeNull();
    expect(pagesProblem(t, "bw_white", 10)).toBe("low");
    expect(pagesProblem(t, "bw_white", 900)).toBe("high");
    expect(pagesProblem(t, "color_standard", 50)).toBe("low");
    expect(pagesProblem(t, "bw_white", 12.5)).toBe("format");
    expect(pagesProblem(trimSpec("8.27x11.69")!, "color_standard", 100)).toBe("unavailable");
  });
});

describe("printing cost and royalty, against KDP's worked examples", () => {
  it("prices a 300-page black-ink regular-trim book at $4.60", () => {
    expect(round(printingCost(trimSpec("6x9")!, "bw_white", 300), 2)).toBe(4.6);
  });

  it("charges the flat price up to 110 pages and the per-page price after", () => {
    const t = trimSpec("6x9")!;
    expect(printingCost(t, "bw_white", 110)).toBe(2.3);
    expect(round(printingCost(t, "bw_white", 111), 3)).toBe(2.332);
    expect(printingCost(t, "color_premium", 40)).toBe(3.6);
    expect(round(printingCost(t, "color_premium", 100), 2)).toBe(7.5);
    expect(round(printingCost(t, "color_standard", 100), 2)).toBe(3.55);
  });

  it("knows which sizes are large (wider than 6.12 in or taller than 9 in)", () => {
    expect(trimSpec("6x9")!.large).toBe(false);
    expect(trimSpec("5.5x8.5")!.large).toBe(false);
    expect(trimSpec("6.14x9.21")!.large).toBe(true);
    expect(trimSpec("8.25x6")!.large).toBe(true);
    expect(round(printingCost(trimSpec("7x10")!, "bw_white", 300), 2)).toBe(6.1);
    expect(printingCost(trimSpec("7x10")!, "bw_white", 100)).toBe(2.84);
  });

  it("pays 60% from $9.99 and 50% below, and reproduces KDP's $15 example: $4.00", () => {
    expect(royaltyRate(9.98)).toBe(0.5);
    expect(royaltyRate(9.99)).toBe(0.6);
    // KDP's example: a 333-page black-ink book at $15 has a $5.00 printing cost and earns $4.00.
    const cost = round(printingCost(trimSpec("6x9")!, "bw_white", 333), 2);
    expect(cost).toBe(5);
    expect(round(royalty(15, cost), 2)).toBe(4);
    // Expanded Distribution: 40%.
    expect(round(royalty(15, cost, true), 2)).toBe(1);
  });

  it("finds the lowest list price: cost over 50% while that is under $9.99, else over 60%, never under $9.99", () => {
    expect(minListPrice(4.6)).toBe(9.2);
    expect(minListPrice(2.3)).toBe(4.6);
    expect(minListPrice(5.8)).toBe(9.99);
    expect(minListPrice(8)).toBe(13.34);
    for (const cost of [2.3, 4.6, 5, 5.8, 8, 12.5]) {
      const min = minListPrice(cost);
      expect(royalty(min, cost)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("agrees with the pricing-page sources on every ink", () => {
    for (const ink of INKS) expect(FIGURES.printCost[ink].regular.perPage).toBeLessThan(FIGURES.printCost[ink].large.perPage);
  });
});

describe("words to pages", () => {
  it("lands on the real page count of the sample edition of The Wonderful Wizard of Oz", () => {
    // 39,344 words in 24 chapters; Book Studio sets it in 140 pages (6 × 9 in, 11.5 pt on 15 pt).
    const r = wordsToPages({ words: 39_344, trim: { width: 6, height: 9 }, fontPt: 11.5, leading: 15 / 11.5, chapters: 24, frontBack: 10 })!;
    expect(Math.abs(r.pages - 140) / 140).toBeLessThan(0.15);
  });

  it("gives an even count, grows with the words and shrinks with a bigger page", () => {
    const base = { trim: { width: 6, height: 9 }, fontPt: 11, leading: 1.3, chapters: 20, frontBack: 10 };
    const a = wordsToPages({ ...base, words: 60_000 })!;
    const b = wordsToPages({ ...base, words: 90_000 })!;
    const c = wordsToPages({ ...base, words: 60_000, trim: { width: 8.5, height: 11 } })!;
    const d = wordsToPages({ ...base, words: 60_000, fontPt: 13 })!;
    expect(a.pages % 2).toBe(0);
    expect(b.pages).toBeGreaterThan(a.pages);
    expect(c.pages).toBeLessThan(a.pages);
    expect(d.pages).toBeGreaterThan(a.pages);
    expect(wordsToPages({ ...base, words: 0 })).toBeNull();
  });
});

describe("the cover template PDF", () => {
  it("is a one-page PDF with the cover's exact size in points, readable by a PDF library", async () => {
    const c = coverSize({ width: 6, height: 9 }, 300, "bw_white");
    const labels = { title: "T", back: "Back", spine: "Spine", front: "Front", bleed: "b", trim: "t", safe: "s", barcode: "bc", noSpineText: "n", size: "z (é)" };
    const bytes = templatePdf(c.width, c.height, coverTemplate(c, true, labels));
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(c.width * 72, 2);
    expect(height).toBeCloseTo(c.height * 72, 2);
  });

  it("draws the bleed, the trim, both folds, the safe areas and the barcode guide, and drops the spine area without spine text", () => {
    const c = coverSize({ width: 6, height: 9 }, 300, "bw_white");
    const labels = { title: "T", back: "Back", spine: "Spine", front: "Front", bleed: "b", trim: "t", safe: "s", barcode: "bc", noSpineText: "n", size: "z" };
    const withText = coverTemplate(c, true, labels);
    const without = coverTemplate(coverSize({ width: 6, height: 9 }, 60, "bw_white"), false, labels);
    const folds = withText.filter((o) => o.k === "line");
    expect(folds.map((o) => (o.k === "line" ? round(o.x1, 4) : 0))).toEqual([6.125, 6.8006]);
    expect(withText.filter((o) => o.k === "rect" && o.dash && o.stroke).length).toBe(4); // back, front, spine, barcode
    expect(without.filter((o) => o.k === "rect" && o.dash && o.stroke).length).toBe(3);
  });
});

/** A reader for EAN-13 that knows only the GS1 standard: it measures bar and space widths, like a scanner. */
function readEan13(svg: string): string {
  const total = QUIET.left + MODULES + QUIET.right;
  const unit = 2; // barcodeSvg(…, 2)
  const px = new Uint8Array(total * unit);
  for (const [, x, w] of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) for (let i = Number(x); i < Number(x) + Number(w); i++) px[i] = 1;
  // Run lengths in modules, starting at the first bar.
  const runs: number[] = [];
  let i = px.indexOf(1);
  while (i < px.length && runs.length < 59) {
    let j = i;
    while (j < px.length && px[j] === px[i]) j++;
    runs.push(Math.round((j - i) / unit));
    i = j;
  }
  expect(runs.length).toBe(59);
  expect(runs.slice(0, 3)).toEqual([1, 1, 1]);
  expect(runs.slice(27, 32)).toEqual([1, 1, 1, 1, 1]);
  expect(runs.slice(56)).toEqual([1, 1, 1]);
  // Element widths of the digits 0–9 in the L code (the R code has the same widths); G is the L code reversed.
  const L = ["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112"];
  const G = L.map((w) => [...w].reverse().join(""));
  const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const four = (at: number) => runs.slice(at, at + 4).join("");
  const left: { digit: number; kind: string }[] = [];
  for (let d = 0; d < 6; d++) {
    const w = four(3 + 4 * d);
    const l = L.indexOf(w);
    const g = G.indexOf(w);
    left.push(l >= 0 ? { digit: l, kind: "L" } : { digit: g, kind: "G" });
  }
  const first = PARITY.findIndex((p) => p === left.map((x) => x.kind).join(""));
  let out = String(first) + left.map((x) => x.digit).join("");
  for (let d = 0; d < 6; d++) out += L.indexOf(four(32 + 4 * d));
  return out;
}

describe("the ISBN barcode", () => {
  const isbns = ["9781861978769", "9780306406157", "9798888888889", "9791032300619"];

  it("is read back, digit for digit, by a decoder that knows only the EAN-13 standard", () => {
    for (const digits of isbns) {
      const r = checkIsbn(digits);
      expect(r.ok, digits).toBe(true);
      expect(readEan13(barcodeSvg(digits, 2)), digits).toBe(digits);
    }
  });

  it("has 95 modules of bars and the quiet zones the standard asks for", () => {
    const svg = barcodeSvg("9781861978769", 2);
    expect(svg).toContain(`viewBox="0 0 ${(QUIET.left + MODULES + QUIET.right) * 2}`);
    expect(svg).toContain('aria-label="EAN-13 9781861978769"');
  });

  it("checks ISBN-13 and ISBN-10, with the reason when it fails", () => {
    expect(checkIsbn("978-1-86197-876-9")).toEqual({ ok: true, isbn13: "9781861978769" });
    expect(checkIsbn("0-306-40615-2")).toEqual({ ok: true, isbn13: "9780306406157" });
    expect(checkIsbn("097522980X")).toEqual({ ok: true, isbn13: "9780975229804" });
    expect(checkIsbn("9781861978768")).toEqual({ ok: false, reason: "checksum" });
    expect(checkIsbn("0306406153")).toEqual({ ok: false, reason: "checksum" });
    expect(checkIsbn("12345")).toEqual({ ok: false, reason: "format" });
    expect(checkIsbn("9771234567003")).toEqual({ ok: false, reason: "prefix" });
  });
});

describe("links into the app", () => {
  it("carry the size and the paper the app understands, and leave out a size it can't set", () => {
    expect(appLink("../../../", "7x10", "bw_cream")).toBe("../../../?start=import&trim=7x10&paper=cream");
    expect(appLink("../", "8.5x8.5", "color_premium")).toBe("../?start=import&paper=color");
    expect(appLink("../", "6x9", "color_standard")).toBe("../?start=import&trim=6x9&paper=white");
    expect(query({ a: 1, b: undefined, c: "" })).toBe("?a=1");
  });

  it("are understood by the app: only known sizes and papers get through", () => {
    expect(startSettings("?start=import&trim=7x10&paper=cream")).toEqual({ trim: "7x10", paper: "cream" });
    expect(startSettings("?trim=9x9&paper=glossy")).toEqual({});
    expect(startSettings("")).toEqual({});
    // Every link the tools can make is accepted by the app.
    for (const t of TRIMS) for (const ink of INKS) {
      const s = startSettings(appLink("", t.id, ink).slice(1));
      expect(s.trim, t.id).toBe(t.id);
      expect(["white", "cream", "color"]).toContain(s.paper);
    }
  });
});

describe("the tool pages", () => {
  const read = (lang: string, key: string) => readFileSync(`site/tools/${lang}/${key}.md`, "utf8");

  it("print the per-page spine thickness from the fixture, in both languages", () => {
    const en = read("en", "spine");
    const es = read("es", "spine");
    for (const v of Object.values(FIGURES.spinePerPage)) {
      expect(en).toContain(String(v));
      expect(es).toContain(String(v).replace(".", ","));
    }
  });

  it("print the margin table and the printing-cost rates from the fixture", () => {
    const margin = read("en", "margins");
    for (const r of FIGURES.margins.inside) expect(margin).toContain(`${r.inches}`);
    const cost = read("en", "cost");
    for (const ink of ["bw_white", "color_premium", "color_standard"] as const) {
      const b = FIGURES.printCost[ink];
      expect(cost).toContain(String(b.regular.perPage));
      expect(cost).toContain(String(b.large.perPage));
    }
    expect(cost).toContain("$2.30");
    expect(cost).toContain("$2.84");
  });
});
