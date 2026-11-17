/// <reference types="node" />
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook } from "../src/app/pipeline";
import { auditBook } from "../src/engine/a11y";
import { writeEpub } from "../src/engine/epub";
import type { FontSet } from "../src/engine/fonts";
import { THEMES } from "../src/engine/themes";
import { FREE_THEMES } from "../src/engine/entitlements";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";
import { pngHeader } from "./helpers/png";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const jpg = new Uint8Array(readFileSync(new URL("../sample/oz/images/cover.jpg", import.meta.url)));
const para = "A line of the story that goes on for a while, as stories do, with a comma here and a clause there. ".repeat(12);

function vault(opener: Record<string, string> | null, image: Uint8Array = jpg, theme = "classic") {
  const chapterFm = opener ? `---\n${Object.entries(opener).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n` : "";
  return memVault({
    "Book.md": `---\nbook: true\ntitle: Opener Book\nauthor: Ada Writer\ntheme: ${theme}\n---\n## Chapters\n1. [[One]]\n2. [[Two]]\n`,
    "One.md": `${chapterFm}# One\n\n${para}\n\n${para}\n`,
    "Two.md": `# Two\n\n${para}\n`,
    "pic.jpg": image,
    "tiny.png": pngHeader(200, 100),
  });
}

const imageDraws = (built: Awaited<ReturnType<typeof buildBook>>, chapterId: string) =>
  built.layout.pages.filter((p) => p.chapterId === chapterId && p.role === "opener").flatMap((p) => p.draws.filter((d) => d.kind === "image"));

describe("chapter openers with an image", () => {
  it("reads chapter-image and its description from the chapter note", async () => {
    const built = await buildBook(vault({ "chapter-image": "pic.jpg", "chapter-image-alt": "A road through a field" }), "Book.md", fonts);
    const ch = built.book.chapters[0];
    expect(ch.openerImage).toMatchObject({ target: "pic.jpg", alt: "A road through a field", decorative: false });
    expect(ch.openerImage?.path).toBeTruthy();
    expect(built.book.chapters[1].openerImage).toBeUndefined();
    expect(built.book.images.has(ch.openerImage!.path)).toBe(true);
  });

  const themes = THEMES.filter((t) => FREE_THEMES.includes(t.id));
  it.each(themes.map((t) => t.id))("draws the picture above the title on the opener, in the %s style", async (theme) => {
    const built = await buildBook(vault({ "chapter-image": "pic.jpg", "chapter-image-alt": "A road" }, jpg, theme), "Book.md", fonts);
    const pics = imageDraws(built, "ch1");
    expect(pics).toHaveLength(1);
    expect(imageDraws(built, "ch2")).toHaveLength(0);
    const opener = built.layout.pages.find((p) => p.chapterId === "ch1" && p.role === "opener")!;
    const title = opener.draws.filter((d) => d.kind === "text").map((d) => d.y);
    expect(pics[0].y + pics[0].h).toBeLessThan(Math.min(...title) + 1);
    // At most 70 % of the text block wide and 30 % of its height tall.
    const m = built.layout.margins;
    expect(pics[0].w).toBeLessThanOrEqual(0.7 * (built.layout.widthPt - m.inside - m.outside) + 0.01);
    expect(pics[0].h).toBeLessThanOrEqual(0.3 * (built.layout.heightPt - m.top - m.bottom) + 0.01);
  });

  it("warns when the picture prints under 300 ppi and not otherwise", async () => {
    const small = await buildBook(vault({ "chapter-image": "tiny.png", "chapter-image-alt": "Tiny" }), "Book.md", fonts);
    expect(small.layout.warnings.some((w) => /opens the chapter “One” at \d+ ppi/.test(w.message))).toBe(true);
    const plain = await buildBook(vault(null), "Book.md", fonts);
    expect(plain.layout.warnings.some((w) => /opens the chapter/.test(w.message))).toBe(false);
  });

  it("says so when the picture cannot be found", async () => {
    const built = await buildBook(vault({ "chapter-image": "nope.jpg" }), "Book.md", fonts);
    expect(built.book.warnings.some((w) => /Chapter image not found: nope.jpg/.test(w.message))).toBe(true);
    expect(imageDraws(built, "ch1")).toHaveLength(0);
  });

  it("goes into the EPUB with its description, and the accessibility audit asks for one", async () => {
    const built = await buildBook(vault({ "chapter-image": "pic.jpg", "chapter-image-alt": "A road through a field" }), "Book.md", fonts);
    const zip = await JSZip.loadAsync(await writeEpub(built.book, { accessiblePack: false, fonts, modified: new Date("2026-01-01T00:00:00Z") }));
    const html = await zip.file("EPUB/text/ch1.xhtml")!.async("string");
    expect(html).toMatch(/<figure class="chapter-image"><img src="\.\.\/images\/[^"]+" alt="A road through a field"\/><\/figure>/);
    expect(await zip.file("EPUB/text/ch2.xhtml")!.async("string")).not.toMatch(/chapter-image/);
    const noAlt = await buildBook(vault({ "chapter-image": "pic.jpg" }), "Book.md", fonts);
    expect(auditBook(noAlt.book, { pageList: false }).issues.some((i) => i.rule === "img-alt")).toBe(true);
    const deco = await buildBook(vault({ "chapter-image": "pic.jpg", "chapter-image-alt": "decorative" }), "Book.md", fonts);
    expect(auditBook(deco.book, { pageList: false }).issues.some((i) => i.rule === "img-alt")).toBe(false);
  });
});
