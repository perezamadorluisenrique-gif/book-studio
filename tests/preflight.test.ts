/// <reference types="node" />
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportPdf } from "../src/app/pipeline";
import { runPreflight, PREFLIGHT_RULES, type PreflightReport } from "../src/engine/preflight";
import type { FontSet } from "../src/engine/fonts";
import { writePdf } from "../src/engine/pdf";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";
import { pngHeader } from "./helpers/png";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const para = "A line of the story that goes on for a while, as stories do. ".repeat(40);
function vault(front: Record<string, string> = {}, extra: Record<string, string | Uint8Array> = {}, chapters = 3) {
  const fm = Object.entries({ book: "true", title: "Preflight Book", author: "Ada Writer", ...front }).map(([k, v]) => `${k}: ${v}`);
  const names = Array.from({ length: chapters }, (_, i) => `Ch${i + 1}`);
  return memVault({
    "Book.md": `---\n${fm.join("\n")}\n---\n## Chapters\n${names.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(names.map((n, i) => [`${n}.md`, `# ${n}\n\n${para}\n\n${para}\n`])),
    ...extra,
  });
}

async function check(front: Record<string, string> = {}, extra: Record<string, string | Uint8Array> = {}, chapters = 3, withPdf = true): Promise<PreflightReport> {
  const built = await buildBook(vault(front, extra, chapters), "Book.md", fonts);
  const pdf = withPdf ? (await exportPdf(built, fonts)).data : undefined;
  return runPreflight({ book: built.book, layout: built.layout, fonts, pdf });
}
const rulesOf = (r: PreflightReport, severity?: string) => r.findings.filter((f) => !severity || f.severity === severity).map((f) => f.rule);

describe("preflight", () => {
  it("passes a clean book on every rule that applies", async () => {
    const r = await check({ isbn: "9780306406157" });
    expect(r.errors).toBe(0);
    expect(r.ok).toBe(true);
    expect(rulesOf(r, "warning")).not.toContain("text-safe");
    // Every rule is either passed, skipped or has a finding: none is silently dropped.
    const accounted = new Set([...r.passed.map((x) => x.id), ...r.skipped.map((x) => x.id), ...r.findings.map((f) => f.rule)]);
    for (const rule of PREFLIGHT_RULES) expect(accounted.has(rule.id), rule.id).toBe(true);
    expect(r.passed.map((x) => x.id)).toEqual(expect.arrayContaining(["page-count", "inside-margin", "outside-margins", "text-safe", "pdf-fonts", "pdf-size", "pdf-pages"]));
  });

  it("skips the PDF rules when no PDF is given, and says so", async () => {
    const r = await check({}, {}, 3, false);
    expect(r.skipped.map((x) => x.id).sort()).toEqual(["pdf-file-size", "pdf-fonts", "pdf-pages", "pdf-size"]);
  });

  it("flags an invalid ISBN as an error and a missing one as a note", async () => {
    const bad = await check({ isbn: "978-0-306-40615-8" });
    expect(bad.findings.find((f) => f.rule === "isbn")).toMatchObject({ severity: "error" });
    expect(bad.ok).toBe(false);
    const none = await check({});
    expect(none.findings.find((f) => f.rule === "isbn")).toMatchObject({ severity: "info" });
    expect(none.ok).toBe(true);
  });

  it("warns about low-resolution images with the page they are on", async () => {
    const r = await check({}, { "wide.png": pngHeader(600, 400) }, 1);
    // pngHeader is a header only and can't be embedded, so look at the layout-level rule alone.
    const built = await buildBook(vault({}, { "wide.png": pngHeader(600, 400), "Ch1.md": "# Ch1\n\n![A wide picture of the sea](wide.png)\n" }, 1), "Book.md", fonts);
    const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
    const f = report.findings.find((x) => x.rule === "image-resolution");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("warning");
    expect(f?.page).toBeTruthy();
    expect(f?.message).toMatch(/ppi/);
    expect(r.errors).toBe(0);
  });

  it("reports PNG transparency", async () => {
    const built = await buildBook(vault({}, { "wide.png": pngHeader(2400, 1600), "Ch1.md": "# Ch1\n\n![A wide picture of the sea](wide.png)\n" }, 1), "Book.md", fonts);
    const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
    // pngHeader declares colour type 6 (RGBA).
    expect(report.findings.some((x) => x.rule === "transparency")).toBe(true);
  });

  it("catches text that reaches into the margin", async () => {
    const built = await buildBook(vault({}, {}, 1), "Book.md", fonts);
    const page = built.layout.pages.find((p) => p.role === "body")!;
    const t = page.draws.find((d) => d.kind === "text")!;
    if (t.kind === "text") t.x = 2;
    const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
    const f = report.findings.find((x) => x.rule === "text-safe");
    expect(f).toMatchObject({ severity: "error", page: page.folio });
  });

  it("catches an image on the page edge without bleed", async () => {
    const built = await buildBook(vault({}, {}, 1), "Book.md", fonts);
    built.layout.pages[8].draws.push({ kind: "image", x: 0, y: 100, w: 200, h: 100, path: "x.png", alt: "" });
    const report = await runPreflight({ book: built.book, layout: built.layout, fonts });
    expect(rulesOf(report, "error")).toContain("image-edge");
  });

  it("flags too many blank pages in a row but not the padding at the end", async () => {
    const built = await buildBook(vault({}, {}, 6), "Book.md", fonts);
    expect(rulesOf(await runPreflight({ book: built.book, layout: built.layout, fonts }))).not.toContain("blank-pages");
    const pages = built.layout.pages;
    expect(pages[16].role).not.toBe("blank");
    for (let i = 10; i < 14; i++) pages[i] = { ...pages[i], role: "blank", draws: [] };
    const r = await runPreflight({ book: built.book, layout: built.layout, fonts });
    expect(r.findings.find((f) => f.rule === "blank-pages")?.message).toMatch(/^[4-9] blank pages in a row/);
  });

  it("checks the written PDF against the layout", async () => {
    const built = await buildBook(vault({}, {}, 1), "Book.md", fonts);
    const other = await buildBook(vault({}, {}, 8), "Book.md", fonts);
    expect(other.layout.pages.length).not.toBe(built.layout.pages.length);
    const pdf = await writePdf(other.book, other.layout, fonts, {});
    const r = await runPreflight({ book: built.book, layout: built.layout, fonts, pdf });
    expect(rulesOf(r, "error")).toContain("pdf-pages");
    // A PDF at another trim than the layout says.
    const small = await buildBook(vault({ trim: "5x8" }, {}, 1), "Book.md", fonts);
    const wrong = await runPreflight({ book: built.book, layout: built.layout, fonts, pdf: await writePdf(small.book, small.layout, fonts, {}) });
    expect(rulesOf(wrong, "error")).toContain("pdf-size");
  });

  it("every PDF Book Studio writes has all its fonts embedded", async () => {
    const real = readFileSync(new URL("../sample/oz/images/cover.jpg", import.meta.url));
    expect(real.length).toBeGreaterThan(0);
    const r = await check({ theme: "modern" });
    expect(r.passed.map((x) => x.id)).toContain("pdf-fonts");
  });
});
