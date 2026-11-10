/// <reference types="node" />
// Typographic quality bench: sets every book in the bench and prints the defect
// counts as a Markdown table.
//
//   npm run quality              # print the table
//   npm run quality -- --write   # also save tests/quality-baseline.json
//
// The baseline only ever improves: tests/quality.test.ts fails when any count
// goes above it. Pass --write after a change that lowers a number.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FontSet } from "../src/engine/fonts";
import { baselineOf, DEFECTS, measureAll } from "./quality-books";

const root = fileURLToPath(new URL("..", import.meta.url));
const say = (line: string): void => void process.stdout.write(`${line}\n`);

const fonts = await FontSet.load(async (f) => new Uint8Array(readFileSync(new URL(`../fonts/${f}.ttf`, import.meta.url))));
// The first layout also warms the engine; set Oz once before timing anything.
await measureAll(root, fonts);
const results = await measureAll(root, fonts);

say(`| Book | Pages | Lines | Short pages | Uneven spreads | Ladders | Very loose | Loose | Widows | Orphans | Hyphen turns | Hyphens | Layout ms |`);
say(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  const q = r.quality;
  say(`| ${r.book} | ${r.pages} | ${q.lines} | ${DEFECTS.map((d) => q[d]).slice(0, 8).join(" | ")} | ${q.hyphens} | ${r.ms} |`);
}

if (process.argv.includes("--write")) {
  writeFileSync(new URL("../tests/quality-baseline.json", import.meta.url), `${JSON.stringify(baselineOf(results), null, 2)}\n`);
  say("\nWrote tests/quality-baseline.json");
}
