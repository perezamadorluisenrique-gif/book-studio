import { describe, expect, it } from "vitest";
import { parseMarkdown, plainText, type ParseContext } from "../src/engine/markdown";
import { latexToMarkup } from "../src/engine/math";

function ctx(): ParseContext {
  let n = 0;
  return { file: "Note.md", lang: "en", smart: true, nextId: () => `b${++n}`, resolve: () => null, readNote: async () => "", warnings: [] };
}
const strip = (s: string) => s.replace(/[\ue020-\ue027]/g, "");

describe("latexToMarkup", () => {
  it("turns Greek letters and operators into Unicode", () => {
    expect(strip(latexToMarkup("\\alpha \\leq \\infty").text)).toBe("α\u2005≤\u2005∞");
  });
  it("writes fractions and roots in line", () => {
    expect(strip(latexToMarkup("\\frac{a}{b}").text)).toBe("a/b");
    expect(strip(latexToMarkup("\\frac{a+b}{2}").text)).toContain("(a\u2005+\u2005b)/2");
    expect(strip(latexToMarkup("\\sqrt{x}").text)).toBe("√x");
  });
  it("marks superscripts and subscripts", () => {
    const t = latexToMarkup("x_i^2").text;
    expect(t).toContain("\ue022");
    expect(t).toContain("\ue020");
  });
  it("reports what it cannot set", () => {
    expect(latexToMarkup("\\begin{pmatrix} a \\end{pmatrix}").unsupported).toEqual(["pmatrix"]);
    expect(latexToMarkup("\\weirdcmd").unsupported).toEqual(["\\weirdcmd"]);
  });
});

describe("math in notes", () => {
  it("sets inline formulas with sub/superscript styles and no dollar signs", async () => {
    const { blocks } = await parseMarkdown("Energy is $E = mc^2$ here, cost $5 and $6.\n", ctx());
    const p = blocks[0];
    if (p.kind !== "paragraph") throw new Error("paragraph");
    const text = plainText(p.inlines);
    expect(text).toContain("E");
    expect(text).toContain("$5 and $6");
    expect(text).not.toContain("mc^2");
    expect(p.inlines.some((i) => i.kind === "text" && i.style.sup && i.text === "2")).toBe(true);
    expect(p.inlines.some((i) => i.kind === "text" && i.style.math)).toBe(true);
  });
  it("sets display formulas as a centered paragraph, keeping line numbers", async () => {
    const c = ctx();
    const { blocks } = await parseMarkdown("Before.\n\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\n\nAfter.\n", c);
    expect(blocks).toHaveLength(3);
    const m = blocks[1];
    if (m.kind !== "paragraph") throw new Error("paragraph");
    expect(m.align).toBe("center");
    expect(plainText(m.inlines)).toContain("∫");
    expect(plainText(m.inlines)).not.toContain("$");
    expect(blocks[2].src.line).toBe(7);
  });
  it("leaves code spans alone and warns on unsupported commands", async () => {
    const c = ctx();
    const { blocks } = await parseMarkdown("Use `$x$` then $\\weird{y}$.\n", c);
    const p = blocks[0];
    if (p.kind !== "paragraph") throw new Error("paragraph");
    expect(p.inlines.some((i) => i.kind === "text" && i.style.code && i.text === "$x$")).toBe(true);
    expect(c.warnings.some((w) => /not fully supported/.test(w.message))).toBe(true);
  });
});

describe("math in print", () => {
  it("prints formulas with no missing glyphs and keeps the book's own letters apart", async () => {
    const { loadBook } = await import("../src/engine/book");
    const { memVault } = await import("./helpers/memVault");
    const { testFonts } = await import("./helpers/fonts");
    const { layoutHyphenated } = await import("./helpers/layout");
    const book = await loadBook(
      memVault({
        "Book.md": "---\nbook: true\ntitle: T\nauthor: A\n---\n## Chapters\n1. [[One]]\n",
        "One.md": "# One\nThe sum $\\sum_{i=1}^{n} \\alpha_i \\leq \\sqrt{x^2 + y^2}$ holds.\n\n$$\\int_0^\\infty e^{-x}\\,dx = 1$$\n",
      }),
      "Book.md",
    );
    expect(book.warnings).toEqual([]);
    const layout = await layoutHyphenated(book, await testFonts());
    expect(layout.warnings.filter((w) => /No bundled font/.test(w.message))).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);
  });
});
