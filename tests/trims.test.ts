import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportPdf } from "../src/app/pipeline";
import { FREE_THEMES } from "../src/engine/entitlements";
import type { FontSet } from "../src/engine/fonts";
import { averageLineLength, MAX_LINE_CHARS, runPreflight } from "../src/engine/preflight";
import { TRIMS, trimMaxPages } from "../src/engine/trims";
import { testFonts } from "./helpers/fonts";
import { checkKdpPdf } from "../tools/kdp-check";
import { trimById } from "../src/engine/trims";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const para = "A line of the story that goes on for a while, as stories do, with a comma here and a clause there. ".repeat(30);
function vault(extra: Record<string, string> = {}) {
  const fm = Object.entries({ book: "true", title: "Trim Book", author: "Ada Writer", ...extra }).map(([k, v]) => `${k}: ${v}`);
  const names = ["One", "Two", "Three", "Four"];
  return memVault({
    "Book.md": `---\n${fm.join("\n")}\n---\n## Chapters\n${names.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(names.map((n) => [`${n}.md`, `# ${n}\n\n${Array(8).fill(para).join("\n\n")}\n`])),
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
