import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { FontSet } from "../src/engine/fonts";
import { baselineOf, BENCH_BOOKS, DEFECTS, measureAll, type BenchResult } from "../tools/quality-books";
import { testFonts } from "./helpers/fonts";

// The bench sets every book and compares its defect counts with tests/quality-baseline.json.
// A count may go down (then lower the baseline with `npm run quality -- --write`), never up.
const root = new URL("..", import.meta.url).pathname;
const baseline = JSON.parse(readFileSync(new URL("./quality-baseline.json", import.meta.url), "utf8")) as ReturnType<typeof baselineOf>;

let fonts: FontSet;
let results: BenchResult[];

beforeAll(async () => {
  fonts = await testFonts();
  results = await measureAll(root, fonts);
}, 120_000);

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
