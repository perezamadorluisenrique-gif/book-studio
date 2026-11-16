import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportPdf } from "../src/app/pipeline";
import { FREE_THEMES } from "../src/engine/entitlements";
import type { FontSet } from "../src/engine/fonts";
import { averageLineLength, MAX_LINE_CHARS, runPreflight } from "../src/engine/preflight";
import { FREE_TRIMS, TRIMS, trimMaxPages, trimsFor } from "../src/engine/trims";
import { settingsFromFrontmatter } from "../src/engine/manifest";
import { testFonts } from "./helpers/fonts";
import { checkKdpPdf } from "../tools/kdp-check";
import { trimById } from "../src/engine/trims";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const para = "A line of the story that goes on for a while, as stories do, with a comma here and a clause there. ".repeat(30);
function vault(extra: Record<string, string> = {}, paras = 8) {
  const fm = Object.entries({ book: "true", title: "Trim Book", author: "Ada Writer", ...extra }).map(([k, v]) => `${k}: ${v}`);
  const names = ["One", "Two", "Three", "Four"];
  return memVault({
    "Book.md": `---\n${fm.join("\n")}\n---\n## Chapters\n${names.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(names.map((n) => [`${n}.md`, `# ${n}\n\n${Array(paras).fill(para).join("\n\n")}\n`])),
  });
}

interface Figures {
  trims: { width: number; height: number; pages: { bw_white: [number, number] } }[];
}
const figures = JSON.parse(readFileSync("site/tools/data/kdp-figures.json", "utf8")) as Figures;

describe("KDP trim sizes", () => {
  it("are the sixteen of KDP's table, with the page limits it gives", () => {
    expect(TRIMS.length).toBe(16);
    for (const t of TRIMS) {
      const row = figures.trims.find((f) => f.width === t.width && f.height === t.height);
      expect(row, t.id).toBeDefined();
      expect(trimMaxPages(t), t.id).toBe(row!.pages.bw_white[1]);
    }
  });

  it("set a book in each of the nine free styles at every size without a blocking finding", async () => {
    for (const trim of TRIMS) {
      for (const theme of FREE_THEMES) {
        const built = await buildBook(vault(), "Book.md", fonts, { theme, trim: trim.id });
        const errors = built.layout.warnings.filter((w) => w.severity === "error").map((w) => w.message);
        expect(errors, `${theme} at ${trim.id}`).toEqual([]);
        const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
        expect(report.findings.filter((f) => f.severity === "error" && f.rule !== "metadata").map((f) => `${f.rule}: ${f.message}`), `${theme} at ${trim.id}`).toEqual([]);
      }
    }
  }, 240_000);
});

describe("the four added trims print a PDF KDP's checks accept", () => {
  for (const id of ["8.25x6", "8.25x8.25", "8.5x8.5", "8.27x11.69"]) {
    it(`${id}: page box, margins, fonts and page count`, async () => {
      const built = await buildBook(vault(), "Book.md", fonts, { trim: id });
      const bytes = (await exportPdf(built, fonts)).data;
      const r = await checkKdpPdf(bytes, trimById(id)!, { bleed: false, insideMarginPt: built.layout.margins.inside });
      expect(r.errors).toEqual([]);
    });
  }
});

describe("line length", () => {
  it("warns when the lines run past 80 characters and says what to do", async () => {
    const wide = await buildBook(vault(), "Book.md", fonts, { trim: "8.5x11", theme: "minimal" });
    expect(averageLineLength(wide.layout)).toBeGreaterThan(MAX_LINE_CHARS);
    const report = await runPreflight({ book: wide.book, layout: wide.layout, fonts });
    const finding = report.findings.find((f) => f.rule === "line-length");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toMatch(/type size or widen the margins/);
    const normal = await buildBook(vault(), "Book.md", fonts, { trim: "6x9" });
    expect(averageLineLength(normal.layout)).toBeLessThan(MAX_LINE_CHARS);
    expect((await runPreflight({ book: normal.book, layout: normal.layout, fonts })).findings.some((f) => f.rule === "line-length")).toBe(false);
  });
});

describe("hardcover interiors", () => {
  const hard = (front: Record<string, string> = {}) => vault({ binding: "hardcover", trim: "6x9", ...front });

  it("reads the binding from the book note and offers only the five hardcover sizes", async () => {
    expect(settingsFromFrontmatter({ binding: "hardcover" }).binding).toBe("hardcover");
    expect(settingsFromFrontmatter({}).binding).toBeUndefined();
    expect(trimsFor("hardcover").map((t) => t.id)).toEqual(["5.5x8.5", "6x9", "6.14x9.21", "7x10", "8.25x11"]);
    expect(trimsFor("paperback").map((t) => t.id)).not.toContain("8.25x11");
    expect(trimById("8.25x11")).toMatchObject({ width: 8.25, height: 11 });
    expect(FREE_TRIMS).toContain("8.25x11");
  });

  it("blocks a hardcover under 75 pages with its own message, and a paperback of the same length passes", async () => {
    const built = await buildBook(hard(), "Book.md", fonts);
    expect(built.layout.pages.length).toBeLessThan(75);
    const r = await runPreflight({ book: built.book, layout: built.layout, fonts });
    expect(r.findings.find((f) => f.rule === "page-count")?.message).toMatch(/KDP hardcovers need at least 75/);
    const pb = await buildBook(vault({ trim: "6x9" }), "Book.md", fonts);
    expect((await runPreflight({ book: pb.book, layout: pb.layout, fonts })).findings.some((f) => f.rule === "page-count")).toBe(false);
  });

  it("passes a hardcover of 75 pages or more at a hardcover size", async () => {
    const big = await buildBook(vault({ binding: "hardcover", trim: "6x9" }, 40), "Book.md", fonts);
    expect(big.layout.pages.length).toBeGreaterThanOrEqual(75);
    const r = await runPreflight({ book: big.book, layout: big.layout, fonts });
    expect(r.findings.filter((f) => f.rule === "page-count" || f.rule === "binding-trim")).toEqual([]);
    expect(r.passed.find((p) => p.id === "page-count")?.title).toBe("75 to 550 pages");
  });

  it("blocks a size KDP does not print as hardcover, and prints the hardcover-only size", async () => {
    const odd = await buildBook(hard({ trim: "8x10" }), "Book.md", fonts);
    const r = await runPreflight({ book: odd.book, layout: odd.layout, fonts });
    expect(r.findings.find((f) => f.rule === "binding-trim")?.message).toMatch(/does not print hardcovers at 8" × 10"/);
    const tall = await buildBook(hard({ trim: "8.25x11" }), "Book.md", fonts);
    expect(tall.layout.trim.id).toBe("8.25x11");
    expect((await runPreflight({ book: tall.book, layout: tall.layout, fonts })).findings.some((f) => f.rule === "binding-trim")).toBe(false);
  });
});
