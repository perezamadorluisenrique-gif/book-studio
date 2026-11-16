import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { epubParts } from "../src/engine/epub";
import type { FontSet } from "../src/engine/fonts";
import { chapterSrcdoc, FRAMES, PREVIEW_CSP, previewDocs, type EpubFiles } from "../src/app/ebook-preview";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";

// The ebook tab shows the real EPUB files inside a locked iframe. These checks cover the page it builds: the
// Content-Security-Policy that blocks every request, no address that leaves the page, and the chapters in order.
let fonts: FontSet;
let files: EpubFiles;
beforeAll(async () => {
  fonts = await testFonts();
  const book = await loadBook(fsVault(new URL("../sample/oz", import.meta.url).pathname), "The Wonderful Wizard of Oz.md", {});
  files = await epubParts(book, { accessiblePack: false, fonts, modified: new Date("2026-01-01T00:00:00Z") });
}, 60_000);

describe("ebook preview", () => {
  it("lists the reading documents in order, without the navigation page", () => {
    const docs = previewDocs(files);
    expect(docs.length).toBeGreaterThan(3);
    expect(docs.some((d) => /nav/i.test(d.path))).toBe(false);
    expect(docs.every((d) => files.has(d.path))).toBe(true);
  });

  it("builds a page with the policy and only data: addresses", () => {
    const docs = previewDocs(files);
    for (const frame of Object.keys(FRAMES) as Array<keyof typeof FRAMES>) {
      for (const d of docs) {
        const html = chapterSrcdoc(files, d.path, { size: 100, dark: false, frame });
        expect(html).toContain(PREVIEW_CSP);
        const refs = [...html.matchAll(/(?:src|href)="([^"]*)"|url\("([^"]*)"\)/g)].map((m) => m[1] ?? m[2]);
        for (const ref of refs) expect(ref, d.path).toMatch(/^(data:|#|$)/);
        expect(html).not.toMatch(/<script/i);
      }
    }
  });

  it("sets the text size and dark mode in the page", () => {
    const doc = previewDocs(files)[1].path;
    expect(chapterSrcdoc(files, doc, { size: 125, dark: false, frame: "phone" })).toContain("font-size: 125%");
    expect(chapterSrcdoc(files, doc, { size: 100, dark: true, frame: "eink" })).toContain("#15171a");
  });
});
