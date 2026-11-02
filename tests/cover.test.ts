/// <reference types="node" />
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, buildCover, exportCover, type Built } from "../src/app/pipeline";
import { composeCover, contrastInk, hexToRgb } from "../src/engine/cover/cover";
import { coverGeometry, coverPixels, SPINE_PER_PAGE, spineWidth } from "../src/engine/cover/geometry";
import type { FontSet } from "../src/engine/fonts";
import type { TextDraw } from "../src/engine/layout/types";
import { trimById } from "../src/engine/trims";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
const jpg = new Uint8Array(readFileSync(new URL("../sample/oz/images/cover.jpg", import.meta.url)));

const chapter = (n: number) => `# Chapter ${n}\n\n${"A line of the story that goes on for a while, as stories do. ".repeat(60)}\n`;
function vault(front: Record<string, string>, extra: Record<string, string | Uint8Array> = {}, chapters = 3) {
  const names = Array.from({ length: chapters }, (_, i) => `Ch${i + 1}`);
  const fm = Object.entries({ book: "true", title: "The Lighthouse Keeper", author: "Jane Doe", ...front }).map(([k, v]) => `${k}: ${v}`);
  return memVault({
    "Book.md": `---\n${fm.join("\n")}\n---\n## Chapters\n${names.map((n, i) => `${i + 1}. [[${n}]]`).join("\n")}\n`,
    ...Object.fromEntries(names.map((n, i) => [`${n}.md`, chapter(i + 1)])),
    ...extra,
  });
}

beforeAll(async () => {
  fonts = await testFonts();
});

describe("cover geometry", () => {
  const trim = trimById("6x9")!;

  it("follows KDP's spine formula for each paper", () => {
    expect(SPINE_PER_PAGE).toEqual({ white: 0.002252, cream: 0.0025, color: 0.002347 });
    expect(spineWidth(300, "white")).toBeCloseTo(0.6756, 4);
    expect(spineWidth(300, "cream")).toBeCloseTo(0.75, 4);
    expect(spineWidth(300, "color")).toBeCloseTo(0.7041, 4);
  });

  it.each([
    [24, "white", 0.054048],
    [150, "cream", 0.375],
    [300, "color", 0.7041],
    [828, "white", 1.864656],
  ] as const)("sizes the sheet for %i pages on %s paper", (pages, paper, spine) => {
    const g = coverGeometry(trim, pages, paper);
    expect(g.spine).toBeCloseTo(spine, 5);
    expect(g.width).toBeCloseTo(2 * 0.125 + 2 * 6 + spine, 5);
    expect(g.height).toBeCloseTo(9.25, 6);
    // Back, spine and front tile the sheet between the bleeds with no gaps.
    expect(g.back.x + g.back.w).toBeCloseTo(g.spineBox.x, 9);
    expect(g.spineBox.x + g.spineBox.w).toBeCloseTo(g.front.x, 9);
    expect(g.front.x + g.front.w + g.bleed).toBeCloseTo(g.width, 9);
  });

  it("keeps the barcode box 2 × 1.2 in at the back cover's lower right", () => {
    const g = coverGeometry(trim, 200, "white");
    expect(g.barcode).toMatchObject({ w: 2, h: 1.2 });
    expect(g.barcode.x + g.barcode.w).toBeCloseTo(g.back.x + g.back.w - 0.25, 9);
    expect(g.barcode.y + g.barcode.h).toBeCloseTo(g.back.y + g.back.h - 0.25, 9);
  });

  it("puts text on the spine only from 79 pages", () => {
    expect(coverGeometry(trim, 78).spineText).toBe(false);
    expect(coverGeometry(trim, 79).spineText).toBe(true);
  });

  it("asks for 300 ppi pixels", () => {
    const g = coverGeometry(trim, 300, "white");
    // 12.9256 in × 9.25 in at 300 ppi.
    expect(coverPixels(g)).toEqual({ width: 3878, height: 2775 });
  });
});

describe("colour helpers", () => {
  it("picks readable ink", () => {
    expect(contrastInk(hexToRgb("#0c0c0f"))).toEqual([1, 1, 1]);
    expect(contrastInk(hexToRgb("#f4eee0"))[0]).toBeLessThan(0.2);
    expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
  });
});

describe("composeCover", () => {
  async function cover(front: Record<string, string>, extra: Record<string, string | Uint8Array> = {}, chapters = 3, guides = false) {
    const built = await buildBook(vault(front, extra, chapters), "Book.md", fonts);
    return { built, cover: composeCover(built.book, fonts, built.layout.pages.length, { guides }) };
  }

  it("makes one page the size of the sheet", async () => {
    const { built, cover: c } = await cover({});
    const g = c.geometry;
    expect(g.pages).toBe(built.layout.pages.length);
    expect(c.layout.pages).toHaveLength(1);
    expect(c.layout.widthPt).toBeCloseTo(g.width * 72, 6);
    expect(c.layout.heightPt).toBeCloseTo(g.height * 72, 6);
  });

  it("typesets the title and author when there is no cover image", async () => {
    const { cover: c } = await cover({ subtitle: "A Novel" });
    const text = c.layout.pages[0].draws.filter((d): d is TextDraw => d.kind === "text").map((d) => d.text).join(" ");
    expect(text).toContain("Lighthouse");
    expect(text).toContain("Jane");
    expect(text).toContain("Novel");
  });

  it("draws the cover image behind the front panel, clipped to it and the bleed", async () => {
    const { cover: c } = await cover({ cover: "cover.jpg" }, { "cover.jpg": jpg });
    const img = c.layout.pages[0].draws.find((d) => d.kind === "image");
    expect(img).toBeDefined();
    if (img?.kind !== "image") return;
    const f = c.geometry.frontBleed;
    expect(img.clip).toMatchObject({ x: f.x * 72, y: 0, w: f.w * 72, h: f.h * 72 });
    // The image covers its clip box completely.
    expect(img.x).toBeLessThanOrEqual(img.clip!.x + 1e-6);
    expect(img.x + img.w).toBeGreaterThanOrEqual(img.clip!.x + img.clip!.w - 1e-6);
    expect(img.y).toBeLessThanOrEqual(1e-6);
    expect(img.y + img.h).toBeGreaterThanOrEqual(img.clip!.h - 1e-6);
  });

  it("warns when the cover image is below 300 ppi", async () => {
    const { cover: c } = await cover({ cover: "cover.jpg" }, { "cover.jpg": jpg });
    // The Oz cover is far smaller than 1,950 × 2,775 pixels.
    expect(c.findings.some((f) => /ppi/.test(f.message))).toBe(true);
  });

  it("leaves spine text off short books and puts it on longer ones, turned to read downwards", async () => {
    const short = (await cover({}, {}, 1)).cover;
    expect(short.geometry.spineText).toBe(false);
    expect(short.layout.pages[0].draws.some((d) => d.kind === "text" && d.angle)).toBe(false);
    expect(short.findings.some((f) => /spine/.test(f.message))).toBe(true);
    const long = (await cover({}, {}, 40)).cover;
    expect(long.geometry.pages).toBeGreaterThanOrEqual(79);
    const rotated = long.layout.pages[0].draws.filter((d): d is TextDraw => d.kind === "text" && d.angle === -90);
    expect(rotated.map((d) => d.text).join("")).toContain("Lighthouse");
    // Rotated text sits inside the spine's safe width.
    const g = long.geometry;
    for (const d of rotated) {
      expect(d.x).toBeGreaterThan((g.spineBox.x + 0.0625) * 72 - 1);
      expect(d.x).toBeLessThan((g.spineBox.x + g.spine - 0.0625) * 72 + 1);
    }
  });

  it("draws a real EAN-13 barcode in the reserved box when the ISBN is valid", async () => {
    const { cover: c } = await cover({ isbn: "978-0-306-40615-7" });
    expect(c.barcode).toBe("9780306406157");
    const b = c.geometry.barcode;
    const bars = c.layout.pages[0].draws.filter((d) => d.kind === "rect" && d.fill?.[0] === 0 && d.x >= b.x * 72 && d.x <= (b.x + b.w) * 72);
    // 30 black runs in a 95-module EAN-13 symbol with these digits is a property of the encoding, not of the drawing.
    expect(bars.length).toBeGreaterThan(20);
    for (const r of bars) if (r.kind === "rect") expect(r.x + r.w).toBeLessThanOrEqual((b.x + b.w) * 72 + 1e-6);
  });

  it("leaves the box white and says why when the ISBN is wrong or missing", async () => {
    const bad = (await cover({ isbn: "978-0-306-40615-8" })).cover;
    expect(bad.barcode).toBeUndefined();
    expect(bad.findings.some((f) => f.severity === "warning" && /check digit/.test(f.message))).toBe(true);
    const none = (await cover({})).cover;
    expect(none.findings.some((f) => /No ISBN/.test(f.message))).toBe(true);
  });

  it("keeps back-cover text out of the barcode box and inside the safe area", async () => {
    const blurb = Array.from({ length: 3 }, () => "A keeper, a storm and a secret the sea has kept for a hundred years. ".repeat(4).trim());
    const { cover: c } = await cover({ "back-blurb": JSON.stringify(blurb.join("\n\n")), "author-bio": '"Jane Doe lives by the sea and writes about it."', tagline: '"Some lights should stay dark."', isbn: "9780306406157" });
    const g = c.geometry;
    const box = g.barcode;
    const backText = c.layout.pages[0].draws.filter((d): d is TextDraw => d.kind === "text" && !d.angle && d.x < (g.back.x + g.back.w) * 72 && d.color?.[0] !== 0);
    expect(backText.length).toBeGreaterThan(5);
    for (const d of backText) {
      const w = fonts.width(d.face, d.text, d.size, d.tracking ?? 0);
      expect(d.x, d.text).toBeGreaterThanOrEqual((g.back.x + 0.25) * 72 - 1e-6);
      expect(d.x + w, d.text).toBeLessThanOrEqual((g.back.x + g.back.w - 0.25) * 72 + 1e-6);
      expect(d.y, d.text).toBeLessThanOrEqual((g.back.y + g.back.h - 0.25) * 72 + 1e-6);
      const overlapsBox = d.x + w > box.x * 72 && d.x < (box.x + box.w) * 72 && d.y > box.y * 72 && d.y - d.size < (box.y + box.h) * 72;
      expect(overlapsBox, d.text).toBe(false);
    }
  });

  it("reads the back blurb from a linked note", async () => {
    const { built } = await cover({ "back-blurb": '"[[Blurb]]"' }, { "Blurb.md": "---\ntitle: x\n---\n\nA **bold** claim.\n\nA second paragraph with a [[Link|link]].\n" });
    expect(built.book.meta.coverDesign.blurb).toEqual(["A bold claim.", "A second paragraph with a link."]);
  });

  it("draws guides only on request", async () => {
    const plain = (await cover({})).cover.layout.pages[0].draws.filter((d) => d.kind === "rect" && d.dash).length;
    const guided = (await cover({}, {}, 3, true)).cover.layout.pages[0].draws.filter((d) => d.kind === "rect" && d.dash).length;
    expect(plain).toBe(0);
    expect(guided).toBeGreaterThan(3);
  });

  it("changes the spine with the paper", async () => {
    const white = (await cover({ paper: "white" })).cover.geometry.spine;
    const cream = (await cover({ paper: "cream" })).cover.geometry.spine;
    expect(cream / white).toBeCloseTo(0.0025 / 0.002252, 6);
  });
});

describe("cover PDF", () => {
  it("is one page exactly the size of KDP's sheet", async () => {
    const built: Built = await buildBook(vault({ cover: "cover.jpg", isbn: "9780306406157" }, { "cover.jpg": jpg }), "Book.md", fonts);
    const out = await exportCover(built, fonts);
    const pdf = await PDFDocument.load(out.data);
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0);
    const g = coverGeometry(trimById("6x9")!, built.layout.pages.length, "white");
    expect(page.getWidth()).toBeCloseTo(g.width * 72, 3);
    expect(page.getHeight()).toBeCloseTo(g.height * 72, 3);
    expect(out.name).toContain("-cover-6x9-");
    expect(buildCover(built, fonts).geometry.pages).toBe(built.layout.pages.length);
  });
});
