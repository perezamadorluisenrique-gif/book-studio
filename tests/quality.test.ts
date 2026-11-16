import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { FontSet } from "../src/engine/fonts";
import { baselineOf, BENCH_BOOKS, DEFECTS, measureAll, measureStyles, styleBaselineOf, type BenchResult, type StyleResult } from "../tools/quality-books";
import { testFonts } from "./helpers/fonts";

// The bench sets every book and compares its defect counts with tests/quality-baseline.json.
// A count may go down (then lower the baseline with `npm run quality -- --write`), never up.
const root = new URL("..", import.meta.url).pathname;
const saved = JSON.parse(readFileSync(new URL("./quality-baseline.json", import.meta.url), "utf8")) as ReturnType<typeof baselineOf> & { "by-style": ReturnType<typeof styleBaselineOf> };
const { "by-style": styleBaseline, ...baseline } = saved;

let fonts: FontSet;
let results: BenchResult[];
let styles: StyleResult[];

beforeAll(async () => {
  fonts = await testFonts();
  results = await measureAll(root, fonts);
  styles = await measureStyles(root, fonts);
}, 240_000);

describe("typographic quality", () => {
  it("has a baseline for every bench book", () => {
    expect(Object.keys(baseline).sort()).toEqual(BENCH_BOOKS.map((b) => b.replace(/^.*\//, "")).sort());
  });

  for (const dir of BENCH_BOOKS) {
    const name = dir.replace(/^.*\//, "");
    for (const defect of DEFECTS) {
      it(`${name}: ${defect} does not exceed the baseline`, () => {
        const r = results.find((x) => x.book === name)!;
        expect(r.quality[defect]).toBeLessThanOrEqual(baseline[name][defect]);
      });
    }
    it(`${name}: counts lines and pages`, () => {
      const r = results.find((x) => x.book === name)!;
      expect(r.quality.lines).toBeGreaterThan(1000);
      expect(r.quality.pages).toBeGreaterThan(50);
    });
  }
});

// Every free style on Oz and on the Spanish essay. The styles of the first release set the bar: a style added
// later may not leave more short pages, uneven spreads or ladders than Classic does with the same book.
describe("typographic quality by style", () => {
  const SINCE_T5 = ["literary", "minimal", "memoir", "textbook"];
  it("has a baseline for every style of every book", () => {
    expect(Object.keys(styleBaseline).sort()).toEqual(["ensayo-es", "oz"]);
    for (const book of Object.keys(styleBaseline)) expect(Object.keys(styleBaseline[book]).sort()).toEqual([...new Set(styles.filter((s) => s.book === book).map((s) => s.style))].sort());
  });

  it("keeps every style at or under its baseline", () => {
    for (const r of styles) for (const d of DEFECTS) expect(r.quality[d], `${r.book} ${r.style} ${d}`).toBeLessThanOrEqual(styleBaseline[r.book][r.style][d]);
  });

  it("lets no new style leave more defects than Classic", () => {
    for (const r of styles.filter((s) => SINCE_T5.includes(s.style))) {
      const classic = styles.find((s) => s.book === r.book && s.style === "classic")!;
      for (const d of ["shortPages", "unevenSpreads", "ladders"] as const) expect(r.quality[d], `${r.book} ${r.style} ${d}`).toBeLessThanOrEqual(classic.quality[d]);
    }
  });
});
