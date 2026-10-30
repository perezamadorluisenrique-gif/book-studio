import { beforeAll, describe, expect, it } from "vitest";
import { buildBook } from "../src/app/pipeline";
import { epubBlockers, printBlockers } from "../src/engine/entitlements";
import type { FontSet } from "../src/engine/fonts";
import type { Layout, TextDraw } from "../src/engine/layout/types";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const filler = "The keeper climbed the stairs, as he had every night for forty years, and found the lamp already lit. ";

function book(opts: { notes: number; footnotes?: string; longNote?: boolean }) {
  const paras: string[] = [];
  const defs: string[] = [];
  for (let n = 1; n <= opts.notes; n++) {
    paras.push(`${filler.repeat(3)}A claim${"[^" + n + "]"} that needs a source. ${filler.repeat(2)}`);
    defs.push(`[^${n}]: ${opts.longNote && n === 2 ? "Verylongnote ".repeat(400) : `Source number NOTEWORD${n} for the claim above, with a few more words to take a line or two.`}`);
  }
  return memVault({
    "Book.md": `---\nbook: true\ntitle: Notes\nauthor: Ada Writer\n${opts.footnotes ? `footnotes: ${opts.footnotes}\n` : ""}---\n## Chapters\n1. [[One]]\n2. [[Two]]\n`,
    "One.md": `# One\n\n${paras.join("\n\n")}\n\n${defs.join("\n")}\n`,
    "Two.md": `# Two\n\n${paras.slice(0, 3).join("\n\n")}\n\n${defs.slice(0, 3).join("\n")}\n`,
  });
}

const text = (l: Layout, i: number) => l.pages[i].draws.filter((d): d is TextDraw => d.kind === "text").map((d) => d.text).join(" ");

describe("footnotes at the foot of the page", () => {
  it("keeps endnotes by default", async () => {
    const b = await buildBook(book({ notes: 4 }), "Book.md", fonts);
    expect(b.book.settings.footnotes).toBe("end");
    expect(b.layout.toc.map((t) => t.title)).toContain("Notes");
  });

  it("puts every note on the page that calls it, below the text, and drops the endnotes chapter", async () => {
    const b = await buildBook(book({ notes: 12, footnotes: "page" }), "Book.md", fonts);
    const { layout } = b;
    expect(layout.toc.map((t) => t.title)).not.toContain("Notes");
    expect(layout.warnings.filter((w) => w.severity === "warning")).toEqual([]);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      // Chapter One's note n and Chapter Two's (n ≤ 3) both say NOTEWORDn.
      const pages = layout.pages.map((_, i) => i).filter((i) => new RegExp(`NOTEWORD${n}\\b`).test(text(layout, i)));
      expect(pages.length, `note ${n}`).toBe(n <= 3 ? 2 : 1);
    }
    const cap = layout.heightPt - layout.margins.top - layout.margins.bottom;
    for (const page of layout.pages) {
      const marker = page.draws.find((d): d is TextDraw => d.kind === "text" && /NOTEWORD/.test(d.text));
      if (!marker) continue;
      // The note sits in the lower part of the text block, under a rule, and never past its end.
      const rule = page.draws.find((d) => d.kind === "rule" && d.x2 - d.x1 < 200 && d.y1 > cap * 0.3);
      expect(rule, `page ${page.folio}`).toBeDefined();
      for (const d of page.draws) if (d.kind === "text" && !/^\d+$/.test(d.text)) expect(d.y).toBeLessThanOrEqual(layout.heightPt - layout.margins.bottom + 12);
    }
  });

  it("loses no body line to the footnotes", async () => {
    const withNotes = await buildBook(book({ notes: 12, footnotes: "page" }), "Book.md", fonts);
    const bodyText = (l: Layout) => l.pages.map((_, i) => text(l, i)).join(" ").replace(/\s+/g, " ");
    // Every sentence of filler text occurs in the output the same number of times as in the endnote layout.
    const plain = await buildBook(book({ notes: 12 }), "Book.md", fonts);
    const count = (s: string) => (s.match(/found the lamp already/g) ?? []).length;
    expect(count(bodyText(withNotes.layout))).toBe(count(bodyText(plain.layout)));
    expect(withNotes.layout.pages.length).toBeGreaterThanOrEqual(plain.layout.pages.length - 3);
  });

  it("cuts a note longer than half a page and says so", async () => {
    const b = await buildBook(book({ notes: 3, footnotes: "page", longNote: true }), "Book.md", fonts);
    expect(b.layout.warnings.some((w) => /longer than half a page/.test(w.message))).toBe(true);
  });

  it("is a Pro setting for print only", () => {
    expect(printBlockers("free", { theme: "classic", trim: "6x9", footnotes: "page" }).map((x) => x.feature)).toEqual(["footnotes"]);
    expect(printBlockers("free", { theme: "classic", trim: "6x9", footnotes: "end" })).toEqual([]);
    expect(printBlockers("pro", { theme: "classic", trim: "6x9", footnotes: "page" })).toEqual([]);
    expect(epubBlockers("free", { theme: "classic" })).toEqual([]);
  });
});
