/// <reference types="node" />
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportPdf, SAMPLE_WATERMARK, type Built } from "../src/app/pipeline";
import { checkIsbn } from "../src/engine/cover/isbn";
import type { FontSet } from "../src/engine/fonts";
import { buildKdpSheet, KDP_LIMITS } from "../src/engine/kdp-sheet";
import { runPreflight } from "../src/engine/preflight";
import { preflightReport } from "../src/engine/preflight-report";
import { THEMES } from "../src/engine/themes";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const text = "The keeper climbed the stairs, as he had every night for forty years, and found the lamp already lit. ".repeat(30);
function vault(front: Record<string, string> = {}, chapters = 3) {
  const fm = Object.entries({ book: "true", title: "The Lamp", author: "Ada Writer", ...front }).map(([k, v]) => `${k}: ${v}`);
  const names = Array.from({ length: chapters }, (_, i) => `Ch${i + 1}`);
  return memVault({
    "Book.md": `---\n${fm.join("\n")}\n---\n## Chapters\n${names.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(names.map((n, i) => [`${n}.md`, `# ${n}\n\n${text}\n\n${text}\n\n*Pause.*\n\n${text}\n`])),
  });
}

describe("new themes", () => {
  it.each(["thriller", "romance", "fantasy"])("%s lays out a book with no missing glyphs and stays on the page", async (id) => {
    const built = await buildBook(vault({ theme: id }), "Book.md", fonts);
    expect(built.book.settings.theme).toBe(id);
    expect(built.layout.warnings.filter((w) => w.severity !== "info")).toEqual([]);
    const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
    expect(report.findings.filter((f) => f.rule === "text-safe")).toEqual([]);
    const theme = THEMES.find((t) => t.id === id)!;
    expect(theme.pro).toBe(true);
    // Chapter openers carry the theme's ornament or label, so the three really do differ from Classic.
    const classic = await buildBook(vault({ theme: "classic" }), "Book.md", fonts);
    const sig = (b: Built) => b.layout.pages.map((p) => p.draws.length).join(",");
    expect(sig(built)).not.toBe(sig(classic));
  });

  it("lists the new themes after the existing five", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["classic", "modern", "elegant", "nonfiction", "large-print", "thriller", "romance", "fantasy"]);
  });
});

describe("paper", () => {
  it("is read from the manifest and defaults to white", async () => {
    expect((await buildBook(vault(), "Book.md", fonts)).book.settings.paper).toBe("white");
    expect((await buildBook(vault({ paper: "cream" }), "Book.md", fonts)).book.settings.paper).toBe("cream");
    expect((await buildBook(vault({ paper: "color" }), "Book.md", fonts)).book.settings.paper).toBe("color");
    expect((await buildBook(vault({ paper: "purple" }), "Book.md", fonts)).book.settings.paper).toBe("white");
  });
});

describe("sample PDF", () => {
  it("is the same book with a watermark on every page, and says SAMPLE in its name", async () => {
    const built = await buildBook(vault({ theme: "fantasy", trim: "7x10" }), "Book.md", fonts);
    const clean = await exportPdf(built, fonts);
    const sample = await exportPdf(built, fonts, { sample: true });
    expect(sample.name).toMatch(/-SAMPLE\.pdf$/);
    expect(clean.name).not.toMatch(/SAMPLE/);
    const a = await PDFDocument.load(clean.data);
    const b = await PDFDocument.load(sample.data);
    expect(b.getPageCount()).toBe(a.getPageCount());
    expect(b.getPage(0).getWidth()).toBeCloseTo(a.getPage(0).getWidth(), 3);
    // Every page's content stream is longer by the watermark's operators.
    const lens = (d: PDFDocument) => d.getPages().map((p) => p.node.Contents()?.toString().length ?? 0);
    expect(SAMPLE_WATERMARK).toContain("SAMPLE");
    const raw = (data: Uint8Array) => new TextDecoder("latin1").decode(data);
    expect(lens(b).length).toBe(lens(a).length);
    expect(sample.data.length).toBeGreaterThan(clean.data.length);
    expect(raw(sample.data).length).toBeGreaterThan(raw(clean.data).length);
  });
});

describe("KDP sheet", () => {
  it("collects what KDP asks for from the manifest", async () => {
    const built = await buildBook(
      vault({ subtitle: "A Novel", series: "Lights", "series-number": "2", isbn: "978-0-306-40615-7", keywords: "[lighthouse, sea, mystery]", publisher: "Tiny Press", description: '"A keeper & his lamp."' }),
      "Book.md",
      fonts,
    );
    const sheet = buildKdpSheet(built.book, built.layout.pages.length);
    const get = (label: string) => sheet.fields.find((f) => f.label === label)?.value;
    expect(get("Title")).toBe("The Lamp");
    expect(get("Series")).toBe("Lights, book 2");
    expect(get("Print ISBN")).toBe("978-0-306-40615-7");
    expect(get("Keywords")).toBe("lighthouse\nsea\nmystery");
    expect(get("Description (HTML)")).toBe("<p>A keeper &amp; his lamp.</p>");
    expect(get("Page count")).toBe(String(built.layout.pages.length));
    expect(get("Interior")).toBe("Black & white, white paper");
    expect(sheet.problems).toEqual([]);
    expect(sheet.text).toContain("Title\nThe Lamp");
  });

  it("names every missing or over-limit item", async () => {
    const kw = Array.from({ length: 9 }, (_, i) => `keyword ${i}`).join(", ");
    const built = await buildBook(vault({ isbn: "978-0-306-40615-8", keywords: `"${kw}"`, author: "" }), "Book.md", fonts);
    const sheet = buildKdpSheet(built.book, 40);
    expect(sheet.problems.join(" ")).toMatch(/No author/);
    expect(sheet.problems.join(" ")).toMatch(/No description/);
    expect(sheet.problems.join(" ")).toMatch(new RegExp(`KDP takes ${KDP_LIMITS.keywords} keywords; 9`));
    expect(sheet.problems.join(" ")).toMatch(/ISBN .* isn't valid/);
    expect(sheet.fields.find((f) => f.label === "Keywords")?.value.split("\n")).toHaveLength(7);
    expect(checkIsbn("978-0-306-40615-8").ok).toBe(false);
  });
});

describe("preflight report", () => {
  it("is a standalone page that says what failed and what passed, and escapes the title", async () => {
    const built = await buildBook(vault({ title: "<b>Risky</b> & Co", isbn: "978-0-306-40615-8" }), "Book.md", fonts);
    const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
    const html = preflightReport(built.book, report, { generator: "Book Studio test", generated: new Date("2026-11-01") });
    expect(html).toContain("&lt;b&gt;Risky&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Risky");
    expect(html).toMatch(/Must fix/);
    expect(html).toContain("Checked and fine");
    expect(html).toContain("KDP's own review makes the final decision");
    expect(html).toContain("2026-11-01");
  });
});
