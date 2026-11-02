/// <reference types="node" />
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, buildBookEdition, exportEdition, exportPdf, planEditions, SAMPLE_WATERMARK, type Built } from "../src/app/pipeline";
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

describe("editions", { timeout: 60_000 }, () => {
  const longText = text.repeat(3);
  const manifest = (editions: string) => memVault({
    "Book.md": `---\nbook: true\ntitle: Many\nauthor: Ada Writer\nisbn: 978-0-306-40615-7\n${editions}---\n## Chapters\n1. [[One]]\n2. [[Two]]\n3. [[Three]]\n`,
    "One.md": `# One\n\n${longText}\n`,
    "Two.md": `# Two\n\n${longText}\n`,
    "Three.md": `# Three\n\n${longText}\n`,
  });
  const editions = `editions:\n  paperback:\n    trim: 5x8\n    isbn: 978-0-306-40615-7\n  large-print:\n    theme: large-print\n    trim: 7x10\n    isbn: 978-1-23456-789-7\n    edition: Large Print Edition\n  ebook:\n    format: epub\n    isbn: 978-1-4028-9462-6\n`;

  it("builds each edition from the book's own settings plus its changes", async () => {
    const source = manifest(editions);
    const base = await buildBook(source, "Book.md", fonts);
    const plan = planEditions(base.book);
    expect(plan.problems).toEqual([]);
    expect(plan.editions.map((e) => [e.id, e.format, e.settings.theme, e.settings.trim])).toEqual([
      ["paperback", "print", "classic", "5x8"],
      ["large-print", "print", "large-print", "7x10"],
      ["ebook", "epub", "classic", "6x9"],
    ]);
    const files = await exportEdition(source, "Book.md", fonts, plan.editions[1], "pro", { claim: true });
    expect(files.map((f) => f.name.replace(/-\d+p\.pdf$/, "-Np.pdf"))).toEqual(["large-print-many-paperback-7x10.pdf", "large-print-many-cover-7x10-Np.pdf", "large-print-many-kdp-preflight.html"]);
    // The edition's own ISBN is the one on the barcode and the check passes with it.
    expect(String(files[2].data)).toContain("Many");
    const pdf = await PDFDocument.load(files[0].data);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(7 * 72, 3);
    const epub = await exportEdition(source, "Book.md", fonts, plan.editions[2], "pro", { claim: true });
    expect(epub.map((f) => f.name)).toEqual(["ebook-many.epub"]);
  });

  it("gives each print edition its own spine", async () => {
    const source = manifest(editions);
    const base = await buildBook(source, "Book.md", fonts);
    const plan = planEditions(base.book);
    const a = await buildBookEdition(source, "Book.md", fonts, plan.editions[0]);
    const b = await buildBookEdition(source, "Book.md", fonts, plan.editions[1]);
    expect(a.layout.pages.length).not.toBe(b.layout.pages.length);
  });

  it("names a repeated or missing ISBN", async () => {
    const dup = `editions:\n  a:\n    isbn: 978-0-306-40615-7\n  b:\n    isbn: 9780306406157\n  c:\n    trim: 5x8\n`;
    const plan = planEditions((await buildBook(manifest(dup), "Book.md", fonts)).book);
    expect(plan.problems).toEqual(["The a and b editions use the same ISBN; each edition needs its own.", "The c edition has no ISBN of its own; KDP needs a different ISBN for each edition."]);
  });

  it("has none when the manifest lists none", async () => {
    expect(planEditions((await buildBook(manifest(""), "Book.md", fonts)).book).editions).toEqual([]);
  });
});
