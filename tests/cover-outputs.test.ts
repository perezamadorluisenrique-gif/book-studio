import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook } from "../src/app/pipeline";
import { composeCover } from "../src/engine/cover/cover";
import { coverGeometry } from "../src/engine/cover/geometry";
import type { CoverDesign } from "../src/engine/cover/design";
import { COVER_TEMPLATES, coverInfo } from "../src/engine/cover/templates";
import type { FontSet } from "../src/engine/fonts";
import type { TextDraw } from "../src/engine/layout/types";
import { writePdf } from "../src/engine/pdf";
import { trimById } from "../src/engine/trims";
import { setEbookCover, EBOOK_COVER_NAME } from "../src/project/cover-image";
import type { Project } from "../src/project/model";
import { coverFit } from "../src/web/cover-export";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `Ch${i + 1}`);
function vault(front: string[], chapters: number, extra: Record<string, string | Uint8Array> = {}) {
  const ns = names(chapters);
  return memVault({
    "Book.md": `---\nbook: true\ntitle: The Lighthouse Keeper\nauthor: Jane Doe\n${front.join("\n")}\n---\n## Chapters\n${ns.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(ns.map((n, i) => [`${n}.md`, `# Chapter ${i + 1}\n\n${"A line of the story that goes on for a while, as stories do. ".repeat(60)}\n`])),
    ...extra,
  });
}

describe("the cover PDF", () => {
  // The sheet KDP asks for, in every combination of trim and page count we ship.
  const combos = [["5x8", 100], ["5x8", 250], ["5x8", 400], ["6x9", 100], ["6x9", 250], ["6x9", 400], ["8.5x11", 100], ["8.5x11", 250], ["8.5x11", 400]] as const;
  it.each(combos)("%s at %i pages has the size coverGeometry gives", async (trim, pages) => {
    const built = await buildBook(vault([`trim: ${trim}`], 6), "Book.md", fonts);
    const g = coverGeometry(trimById(trim)!, pages, "white");
    const book = { ...built.book, meta: { ...built.book.meta, coverLayout: COVER_TEMPLATES[0].build(coverInfo(built.book), g) } };
    const cover = composeCover(book, fonts, pages);
    const pdf = await PDFDocument.load(await writePdf(book, cover.layout, fonts, { producer: "test", title: "cover" }));
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(g.width * 72, 1);
    expect(height).toBeCloseTo(g.height * 72, 1);
  });

  it("paints gradients and patterns into a valid PDF", async () => {
    const built = await buildBook(vault([], 6), "Book.md", fonts);
    const g = coverGeometry(trimById("6x9")!, 200, "white");
    // A gradient template, and the same design over two generated patterns (the Pro templates use these).
    const dusk = COVER_TEMPLATES.find((t) => t.id === "dusk")!.build(coverInfo(built.book), g);
    const designs: [string, CoverDesign][] = [
      ["dusk", dusk],
      ["waves", { ...dusk, background: { kind: "generative", color: "#0a2342", family: "waves", seed: "s", palette: ["#12375f", "#1a4a7a", "#0f2d52"] } }],
      ["constellation", { ...dusk, background: { kind: "generative", color: "#0b1026", family: "constellation", seed: "s", palette: ["#3b4a8f", "#51609f", "#2c3a78"] } }],
    ];
    for (const [id, design] of designs) {
      const book = { ...built.book, meta: { ...built.book.meta, coverLayout: design } };
      const cover = composeCover(book, fonts, 200);
      const bytes = await writePdf(book, cover.layout, fonts, { producer: "test", title: id });
      expect(Buffer.from(bytes).toString("latin1")).toContain("%PDF");
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
  });
});

describe("back cover", () => {
  it("leaves the barcode box white when asked, even with a good ISBN", async () => {
    const built = await buildBook(vault(["isbn: 9780306406157"], 6), "Book.md", fonts);
    const g = coverGeometry(trimById("6x9")!, 200, "white");
    const design = COVER_TEMPLATES[0].build(coverInfo(built.book), g);
    const withCode = composeCover({ ...built.book, meta: { ...built.book.meta, coverLayout: design } }, fonts, 200);
    expect(withCode.barcode).toBe("9780306406157");
    const blank = composeCover({ ...built.book, meta: { ...built.book.meta, coverLayout: { ...design, barcode: "blank" } } }, fonts, 200);
    expect(blank.barcode).toBeUndefined();
    expect(blank.findings.some((f) => /left blank on purpose/.test(f.message))).toBe(true);
    expect(blank.layout.pages[0].draws.filter((d): d is TextDraw => d.kind === "text").some((d) => /ISBN/.test(d.text))).toBe(false);
  });

  it("puts the author photo beside the bio and keeps a template's own picture out of the ebook cover loop", async () => {
    const built = await buildBook(vault(["author-bio: Jane writes.", "author-photo: me.jpg"], 6), "Book.md", fonts);
    const g = coverGeometry(trimById("6x9")!, 200, "white");
    const info = coverInfo(built.book);
    expect(info.photoTarget).toBeUndefined(); // no such file in this vault, so the book has no photo
    const design = COVER_TEMPLATES[0].build({ ...info, photoTarget: "me.jpg", photoAlt: "Jane" }, g);
    const photo = design.layers.find((l) => l.kind === "image" && l.panel === "back");
    expect(photo).toBeDefined();
    const bio = design.layers.find((l) => l.kind === "text" && l.text.includes("Jane writes"));
    expect(bio!.x).toBeGreaterThan(photo!.x + photo!.w);
    // A rendered ebook cover is not offered back to the picture templates.
    const ebook = { ...built.book, meta: { ...built.book.meta, cover: { path: "Images/cover-ebook.jpg", target: EBOOK_COVER_NAME, alt: "", decorative: false } } };
    expect(coverInfo(ebook).coverTarget).toBeUndefined();
  });
});

describe("ebook cover from the designer", () => {
  const p: Project = { id: "p", name: "B", meta: { title: "B", cover: "cover.png" }, settings: {}, sections: [], chapters: [], assets: [{ name: "cover.png", mime: "image/png", data: new Uint8Array([1]) }], updatedAt: 1 };
  it("is kept as an asset and named as the book's cover, replacing the last one", () => {
    const a = setEbookCover(p, new Uint8Array([9]), 5);
    expect(a.meta.cover).toBe(EBOOK_COVER_NAME);
    expect(a.assets.map((x) => x.name).sort()).toEqual(["cover-ebook.jpg", "cover.png"]);
    const b = setEbookCover(a, new Uint8Array([8]), 6);
    expect(b.assets.filter((x) => x.name === EBOOK_COVER_NAME)).toHaveLength(1);
    expect([...b.assets.find((x) => x.name === EBOOK_COVER_NAME)!.data]).toEqual([8]);
  });
});

describe("coverFit", () => {
  it("crops the sides of a front that is too wide a shape and the foot of one that is too tall", () => {
    // 6 × 9 into 1600 × 2560: a little off the sides.
    const a = coverFit(600, 900, 1600, 2560);
    expect(a.sy).toBeCloseTo(0, 9);
    expect(a.sx).toBeGreaterThan(0);
    expect(a.sw / a.sh).toBeCloseTo(1600 / 2560, 9);
    const b = coverFit(900, 600, 1600, 2560);
    expect(b.sx).toBeGreaterThan(0);
    expect(b.sw / b.sh).toBeCloseTo(1600 / 2560, 9);
  });
});
