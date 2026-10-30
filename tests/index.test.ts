import { beforeAll, describe, expect, it } from "vitest";
import { buildBook } from "../src/app/pipeline";
import type { FontSet } from "../src/engine/fonts";
import { buildIndex, formatPages, parseIndexSpecs } from "../src/engine/index-terms";
import { printBlockers } from "../src/engine/entitlements";
import type { TextDraw } from "../src/engine/layout/types";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

describe("index terms", () => {
  it("parses entries, sub-entries, aliases and see references", () => {
    expect(parseIndexSpecs(["Napoleon = Bonaparte | the Emperor", "Napoleon > exile", "lighthouse", "Pharos -> lighthouse", "  ", "# comment only"])).toEqual([
      { main: "Napoleon", match: ["Napoleon", "Bonaparte", "the Emperor"], sub: undefined, see: undefined },
      { main: "Napoleon", sub: "exile", match: ["exile"], see: undefined },
      { main: "lighthouse", match: ["lighthouse"], sub: undefined, see: undefined },
      { main: "Pharos", match: ["Pharos"], sub: undefined, see: "lighthouse" },
    ]);
  });

  it("writes runs of pages as ranges", () => {
    expect(formatPages(["12", "3", "5", "6", "7", "3"])).toBe("3, 5–7, 12");
    expect(formatPages(["4", "5"])).toBe("4–5");
    expect(formatPages([])).toBe("");
  });

  const pages = [
    { folio: "1", text: "Napoleón Bonaparte arrived. The lighthouse stood." },
    { folio: "2", text: "The Emperor lived in exile on Elba. LIGHTHOUSE again." },
    { folio: "3", text: "A light-house is not a lighthouses. Napo- leon left." },
    { folio: "10", text: "Nothing here." },
  ];

  it("finds terms ignoring case and accents, only as whole words, and across a line-end hyphen", () => {
    const { entries, missing } = buildIndex(parseIndexSpecs(["Napoleon = Bonaparte | the Emperor", "lighthouse", "Napoleon > exile", "Pharos -> lighthouse", "dragon"]), pages, "en");
    expect(missing).toEqual(["dragon"]);
    const by = Object.fromEntries(entries.map((e) => [e.main, e]));
    expect(by.Napoleon.pages).toEqual(["1", "2", "3"]);
    expect(by.Napoleon.subs).toEqual([{ sub: "exile", pages: ["2"] }]);
    // "lighthouses" and "light-house" are other words.
    expect(by.lighthouse.pages).toEqual(["1", "2"]);
    expect(by.Pharos).toMatchObject({ see: "lighthouse", pages: [] });
  });

  it("sorts by the book's language", () => {
    const text = [{ folio: "1", text: "ñandú zorro apio ángel" }];
    const es = buildIndex(parseIndexSpecs(["zorro", "ñandú", "apio", "ángel"]), text, "es").entries.map((e) => e.main);
    expect(es).toEqual(["ángel", "apio", "ñandú", "zorro"]);
  });
});

const filler = "The keeper climbed the stairs, as he had every night for forty years, and found the lamp already lit. ";
function book(terms: string) {
  const paras = (n: number) => Array.from({ length: n }, (_, i) => `${filler.repeat(4)}${i === 3 ? "Then Napoleon came ashore at the lighthouse. " : ""}${filler.repeat(2)}`).join("\n\n");
  return memVault({
    "Book.md": `---\nbook: true\ntitle: Indexed\nauthor: Ada Writer\nindex-terms: ${terms}\n---\n## Chapters\n1. [[One]]\n2. [[Two]]\n`,
    "One.md": `# One\n\n${paras(30)}\n`,
    "Two.md": `# Two\n\n${paras(12)}\n`,
  });
}

describe("the index in print", () => {
  it("is set after the book in two columns with page numbers that name the pages the terms are on", async () => {
    const b = await buildBook(book('["Napoleon", "lighthouse", "dragon", "Pharos -> lighthouse"]'), "Book.md", fonts);
    const { layout } = b;
    expect(layout.toc.map((t) => t.title)).toContain("Index");
    const idx = layout.pages.filter((p) => p.chapterId === "index");
    expect(idx.length).toBeGreaterThan(0);
    const text = idx.flatMap((p) => p.draws.filter((d): d is TextDraw => d.kind === "text")).map((d) => d.text).join(" ");
    expect(text).toContain("Napoleon");
    expect(text).toContain("lighthouse");
    expect(text).toMatch(/Pharos, see lighthouse/);
    expect(layout.warnings.some((w) => /“dragon”/.test(w.message))).toBe(true);
    // The pages it names really contain the term.
    const entry = idx[0].draws.filter((d): d is TextDraw => d.kind === "text").map((d) => d.text).join(" ");
    const pages = [...(/Napoleon, ([\d, –]+)/.exec(entry)?.[1].matchAll(/\d+/g) ?? [])].map((m) => Number(m[0]));
    expect(pages.length).toBeGreaterThan(1);
    const bodyStart = layout.bodyStart;
    for (const n of pages) {
      const t = layout.pages[bodyStart + n - 1].draws.filter((d): d is TextDraw => d.kind === "text").map((d) => d.text).join(" ");
      expect(t, `page ${n}`).toMatch(/Napoleon|Napole/);
    }
    // Left and right columns both used on the first index page.
    const xs = new Set(idx[0].draws.filter((d): d is TextDraw => d.kind === "text").map((d) => Math.round(d.x / 50)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("adds nothing when no term is listed", async () => {
    const b = await buildBook(book("[]"), "Book.md", fonts);
    expect(b.layout.toc.map((t) => t.title)).not.toContain("Index");
  });

  it("is a Pro feature for print", () => {
    expect(printBlockers("free", { theme: "classic", trim: "6x9" }, { index: true }).map((x) => x.feature)).toEqual(["index"]);
    expect(printBlockers("pro", { theme: "classic", trim: "6x9" }, { index: true })).toEqual([]);
  });
});
