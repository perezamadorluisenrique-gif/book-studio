/// <reference types="node" />
// The bundled fonts, loaded once per test file.

import { readFileSync } from "node:fs";
import { FontSet } from "../../src/engine/fonts";

let cached: Promise<FontSet> | null = null;

export function testFonts(): Promise<FontSet> {
  cached ??= FontSet.load(async (f) => new Uint8Array(readFileSync(new URL(`../../fonts/${f}.ttf`, import.meta.url))));
  return cached;
}
