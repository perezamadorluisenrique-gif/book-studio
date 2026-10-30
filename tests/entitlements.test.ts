/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { epubBlockers, FREE_THEMES, hasFeature, PRO_FEATURES, printBlockers, themeAllowed, trimAllowed } from "../src/engine/entitlements";
import { FREE_TRIMS, TRIMS } from "../src/engine/trims";
import { THEMES } from "../src/engine/themes";

describe("entitlements", () => {
  it("gives free users Classic and Modern at the three most common trims", () => {
    expect(themeAllowed("free", "classic")).toBe(true);
    expect(themeAllowed("free", "modern")).toBe(true);
    expect(themeAllowed("free", "elegant")).toBe(false);
    for (const trim of ["6x9", "5x8", "5.5x8.5"]) expect(trimAllowed("free", trim)).toBe(true);
    expect(trimAllowed("free", "7x10")).toBe(false);
    expect(printBlockers("free", { theme: "modern", trim: "5x8" })).toEqual([]);
  });

  it("names every Pro feature a free export would need", () => {
    const b = printBlockers("free", { theme: "large-print", trim: "7x10" }, { boxSet: true });
    expect(b.map((x) => x.feature)).toEqual(["largePrint", "trim", "boxSets"]);
    expect(epubBlockers("free", { theme: "elegant" }).map((x) => x.feature)).toEqual(["theme"]);
    expect(printBlockers("pro", { theme: "large-print", trim: "7x10" }, { boxSet: true })).toEqual([]);
  });

  it("keeps Pro features Pro", () => {
    for (const f of Object.keys(PRO_FEATURES) as (keyof typeof PRO_FEATURES)[]) {
      if (f === "theme" || f === "trim") continue;
      expect(hasFeature("free", f), f).toBe(false);
      expect(hasFeature("pro", f), f).toBe(true);
    }
  });
});

// The line we hold: what 0.1.3 let a free user export stays free. Adding a gate that
// blocks anything in this table is a regression, however good the new feature is.
describe("no free feature is ever taken away", () => {
  const FREE_IN_0_1_3 = {
    themes: ["classic", "modern"],
    trims: ["6x9"],
  };

  it("still prints every theme and trim 0.1.3 printed", () => {
    for (const theme of FREE_IN_0_1_3.themes) for (const trim of FREE_IN_0_1_3.trims) expect(printBlockers("free", { theme, trim }), `${theme} ${trim}`).toEqual([]);
    for (const theme of FREE_IN_0_1_3.themes) expect(epubBlockers("free", { theme }), theme).toEqual([]);
  });

  it("lists every earlier free theme and trim as free", () => {
    for (const t of FREE_IN_0_1_3.themes) expect(FREE_THEMES).toContain(t);
    for (const t of FREE_IN_0_1_3.trims) expect(FREE_TRIMS).toContain(t);
  });

  it("only marks Pro what the data says is Pro", () => {
    expect(THEMES.filter((t) => !t.pro).map((t) => t.id).sort()).toEqual([...FREE_THEMES].sort());
    for (const t of TRIMS) expect(trimAllowed("free", t.id)).toBe(FREE_TRIMS.includes(t.id));
  });

  it("never limits how many books a free user can have", () => {
    // The 0.1.x "one free book" rule is gone, and nothing in the app may bring it back.
    expect(Object.keys(PRO_FEATURES)).not.toContain("multiBook");
    const dir = new URL("../src/", import.meta.url);
    const walk = (d: URL): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d).pathname]));
    for (const file of walk(dir).filter((f) => f.endsWith(".ts"))) expect(readFileSync(file, "utf8"), file).not.toMatch(/freeBook|multiBook|checkFreeBook/);
  });
});
