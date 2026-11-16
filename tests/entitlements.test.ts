/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRO_INCLUDED } from "../src/edition";
import { epubBlockers, FREE_FEATURES, FREE_THEMES, hasFeature, PRO_FEATURES, printBlockers, themeAllowed } from "../src/engine/entitlements";
import { FREE_TRIMS, HARDCOVER_ONLY_TRIMS, TRIMS } from "../src/engine/trims";
import { THEMES } from "../src/engine/themes";

describe("entitlements", () => {
  it("gives free users five themes and every KDP trim", () => {
    for (const theme of ["classic", "modern", "elegant", "nonfiction", "large-print"]) expect(themeAllowed("free", theme), theme).toBe(true);
    for (const theme of ["thriller", "romance", "fantasy"]) expect(themeAllowed("free", theme), theme).toBe(false);
    for (const trim of TRIMS) expect(printBlockers("free", { theme: "classic", trim: trim.id }), trim.id).toEqual([]);
    expect(printBlockers("free", { theme: "large-print", trim: "7x10", footnotes: "page" })).toEqual([]);
  });

  it("names every Pro feature a free export would need", () => {
    const b = printBlockers("free", { theme: "thriller", trim: "7x10" }, { boxSet: true, index: true });
    expect(b.map((x) => x.feature)).toEqual(["theme", "index", "boxSets"]);
    expect(epubBlockers("free", { theme: "romance" }).map((x) => x.feature)).toEqual(["theme"]);
    expect(printBlockers("pro", { theme: "thriller", trim: "7x10" }, { boxSet: true })).toEqual([]);
  });

  it("keeps Pro features Pro and free features free", () => {
    for (const f of Object.keys(PRO_FEATURES) as (keyof typeof PRO_FEATURES)[]) {
      if (f === "theme") continue;
      expect(hasFeature("free", f), f).toBe(false);
      expect(hasFeature("pro", f), f).toBe(true);
    }
    for (const f of FREE_FEATURES) {
      if (f === "trim" || f === "theme") continue;
      expect(hasFeature("free", f), f).toBe(true);
    }
  });

  it("describes Pro by what it still adds", () => {
    expect(Object.keys(PRO_FEATURES).sort()).toEqual(["accessiblePack", "boxSets", "editions", "index", "theme"]);
    expect(PRO_FEATURES.theme).toBe("Genre themes: Thriller, Romance, Fantasy and more");
  });
});

// The line we hold: what a free user could export once stays free. Adding a gate that
// blocks anything in these tables is a regression, however good the new feature is.
describe("no free feature is ever taken away", () => {
  const FREE_IN_0_1_3 = {
    themes: ["classic", "modern"],
    trims: ["6x9"],
  };

  // Free since November 2026 (the Vellum plan, section 3): every trim, five themes and six functions.
  const FREE_SINCE_2026_11 = {
    trims: ["5x8", "5.06x7.81", "5.25x8", "5.5x8.5", "6x9", "6.14x9.21", "6.69x9.61", "7x10", "7.44x9.69", "7.5x9.25", "8x10", "8.5x11"],
    themes: ["classic", "modern", "elegant", "nonfiction", "large-print"],
    features: ["trim", "largePrint", "preflight", "cover", "footnotes", "kdpSheet"] as const,
  };

  it("still prints every theme and trim 0.1.3 printed", () => {
    for (const theme of FREE_IN_0_1_3.themes) for (const trim of FREE_IN_0_1_3.trims) expect(printBlockers("free", { theme, trim }), `${theme} ${trim}`).toEqual([]);
    for (const theme of FREE_IN_0_1_3.themes) expect(epubBlockers("free", { theme }), theme).toEqual([]);
  });

  it("lists every earlier free theme and trim as free", () => {
    for (const t of FREE_IN_0_1_3.themes) expect(FREE_THEMES).toContain(t);
    for (const t of FREE_IN_0_1_3.trims) expect(FREE_TRIMS).toContain(t);
  });

  it("keeps free for good everything that became free in November 2026", () => {
    expect(FREE_SINCE_2026_11.trims).toHaveLength(12);
    for (const trim of FREE_SINCE_2026_11.trims) {
      expect(FREE_TRIMS, trim).toContain(trim);
      for (const theme of FREE_SINCE_2026_11.themes) expect(printBlockers("free", { theme, trim, footnotes: "page" }), `${theme} ${trim}`).toEqual([]);
    }
    for (const theme of FREE_SINCE_2026_11.themes) {
      expect(FREE_THEMES, theme).toContain(theme);
      expect(epubBlockers("free", { theme }), theme).toEqual([]);
    }
    for (const f of FREE_SINCE_2026_11.features) {
      expect(FREE_FEATURES, f).toContain(f);
      if (f !== "trim") expect(hasFeature("free", f), f).toBe(true);
    }
  });

  it("only marks Pro what the data says is Pro", () => {
    expect(THEMES.filter((t) => !t.pro).map((t) => t.id).sort()).toEqual([...FREE_THEMES].sort());
    // The genre themes come with the private Pro overlay.
    expect(THEMES.filter((t) => t.pro).map((t) => t.id).sort()).toEqual(PRO_INCLUDED ? ["fantasy", "romance", "thriller"] : []);
    expect([...FREE_TRIMS].sort()).toEqual([...TRIMS, ...HARDCOVER_ONLY_TRIMS].map((t) => t.id).sort());
  });

  it("never limits how many books a free user can have", () => {
    // The 0.1.x "one free book" rule is gone, and nothing in the app may bring it back.
    expect(Object.keys(PRO_FEATURES)).not.toContain("multiBook");
    const dir = new URL("../src/", import.meta.url);
    const walk = (d: URL): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d).pathname]));
    for (const file of walk(dir).filter((f) => f.endsWith(".ts"))) expect(readFileSync(file, "utf8"), file).not.toMatch(/freeBook|multiBook|checkFreeBook/);
  });
});

// Free since the style work of the Vellum plan (T5): four more general styles. They stay free.
const FREE_SINCE_2026_11_T5 = { themes: ["literary", "minimal", "memoir", "textbook"], features: ["style"] as const, trims: ["8.25x6", "8.25x8.25", "8.5x8.5", "8.27x11.69"], hardcoverTrims: ["5.5x8.5", "6x9", "6.14x9.21", "7x10", "8.25x11"] };
describe("the T5 styles stay free", () => {
  it("lets a free user print and publish each of them", () => {
    for (const theme of FREE_SINCE_2026_11_T5.themes) {
      expect(FREE_THEMES, theme).toContain(theme);
      expect(printBlockers("free", { theme, trim: "6x9" }), theme).toEqual([]);
      expect(epubBlockers("free", { theme }), theme).toEqual([]);
    }
  });

  it("prints every one of the four added KDP trims for free", () => {
    for (const trim of FREE_SINCE_2026_11_T5.trims) {
      expect(FREE_TRIMS, trim).toContain(trim);
      expect(printBlockers("free", { theme: "classic", trim }), trim).toEqual([]);
    }
  });

  it("prints every hardcover size for free (T5.5)", () => {
    for (const trim of FREE_SINCE_2026_11_T5.hardcoverTrims) {
      expect(FREE_TRIMS, trim).toContain(trim);
      expect(printBlockers("free", { theme: "classic", trim }), trim).toEqual([]);
    }
  });

  it("keeps the style editor and saving its changes with the book free", () => {
    for (const f of FREE_SINCE_2026_11_T5.features) expect(hasFeature("free", f), f).toBe(true);
  });
});
