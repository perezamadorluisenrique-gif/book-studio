// Tests that a project becomes the right Markdown notes, and that the Starter Book project
// gives the same book as the notes in templates/starter-book.
import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { splitFrontmatter } from "../src/engine/markdown";
import { isManifestFrontmatter } from "../src/engine/manifest";
import { createProject, addChapter, setChapterBody } from "../src/project/ops";
import { bodyStartLine, projectToVault, safeName } from "../src/project/to-vault";
import { fsVault } from "./helpers/fsVault";
import { testFonts } from "./helpers/fonts";
import { layoutHyphenated } from "./helpers/layout";

const mk = (o: Partial<Parameters<typeof createProject>[0]> = {}) => createProject({ id: "p", name: "Starter Book", now: 1, ...o });

describe("projectToVault", () => {
  it("writes a book note with book: true and links to every chapter", async () => {
    const v = projectToVault(mk({ template: true }));
    expect(v.bookPath).toBe("Starter Book.md");
    const text = await v.read(v.bookPath);
    const { frontmatter } = splitFrontmatter(text);
    expect(isManifestFrontmatter(frontmatter)).toBe(true);
    expect(frontmatter.title).toBe("Starter Book");
    expect(text).toMatch(/## Front matter\n\n- \[\[Dedication\]\]/);
    expect(text).toMatch(/## Chapters\n\n1\. \[\[Chapter One\]\]\n2\. \[\[Chapter Two\]\]\n3\. \[\[Chapter Three\]\]/);
    expect(text).toMatch(/## Back matter\n\n- \[\[About the author\]\]/);
    expect(v.paths.sort()).toEqual(["About the author.md", "Chapters/Chapter One.md", "Chapters/Chapter Three.md", "Chapters/Chapter Two.md", "Dedication.md", "Starter Book.md"]);
  });

  it("writes chapter notes with a title line, the text and an optional section", async () => {
    const v = projectToVault(mk({ template: true }));
    expect(await v.read("Dedication.md")).toBe("---\nsection: dedication\n---\n# Dedication\n\nFor someone who made this possible.\n");
    expect(await v.read("Chapters/Chapter Two.md")).toBe("# Chapter Two\n\nKeep going.\n");
  });

  it("quotes front matter values that need it and keeps accents", async () => {
    let p = mk();
    p = { ...p, meta: { ...p.meta, title: "Rojo: “el libro”", author: "Ana María" } };
    const v = projectToVault(p);
    const { frontmatter } = splitFrontmatter(await v.read(v.bookPath));
    expect(frontmatter.title).toBe("Rojo: “el libro”");
    expect(frontmatter.author).toBe("Ana María");
  });

  it("keeps note names unique and safe", async () => {
    let p = mk();
    p = addChapter(p, "body", "Same", 1);
    p = addChapter(p, "body", "Same", 2);
    p = addChapter(p, "body", "Part 1: Start?", 3);
    const v = projectToVault(p);
    expect(v.paths).toContain("Chapters/Same.md");
    expect(v.paths).toContain("Chapters/Same 2.md");
    expect(v.paths).toContain("Chapters/Part 1- Start-.md");
    const book = await loadBook(v, v.bookPath);
    expect(book.warnings.filter((w) => /not found/i.test(w.message))).toEqual([]);
    expect(safeName("///", "x")).toBe("---");
    expect(safeName("", "x")).toBe("x");
  });

  it("a name that matches the book note does not clash with it", async () => {
    const p = addChapter(mk(), "body", "Starter Book", 1);
    const v = projectToVault(p);
    expect(new Set(v.paths.map((x) => x.toLowerCase())).size).toBe(v.paths.length);
    const book = await loadBook(v, v.bookPath);
    expect(book.chapters.length).toBe(2);
  });

  it("loads an empty book without problems", async () => {
    const v = projectToVault(mk());
    const book = await loadBook(v, v.bookPath);
    expect(book.chapters).toHaveLength(1);
    expect(book.meta.title).toBe("Starter Book");
  });

  it("serves images from the project", async () => {
    const p = { ...mk(), assets: [{ name: "cover.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }] };
    const v = projectToVault(p);
    expect(await v.readBinary("Images/cover.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(v.resolve("cover.png", v.bookPath)).toBe("Images/cover.png");
  });

  it("shows the text written into a chapter in the loaded book", async () => {
    const p = setChapterBody(mk(), "c1", "A sentence to find.", 2);
    const v = projectToVault(p);
    const book = await loadBook(v, v.bookPath);
    expect(JSON.stringify(book.chapters[0].blocks)).toContain("A sentence to find.");
  });
});

describe("Starter Book template equivalence", () => {
  it("gives the same book model as the notes in templates/starter-book", async () => {
    const fromFolder = fsVault("templates/starter-book");
    const fromProject = projectToVault(mk({ template: true }));
    const a = await loadBook(fromFolder, "Starter Book.md");
    const b = await loadBook(fromProject, fromProject.bookPath);
    expect(b).toEqual(a);
    expect(b.chapters.length).toBeGreaterThan(0);
  });

  it("gives the same number of pages", async () => {
    const fonts = await testFonts();
    const fromFolder = fsVault("templates/starter-book");
    const fromProject = projectToVault(mk({ template: true }));
    const a = await loadBook(fromFolder, "Starter Book.md");
    const b = await loadBook(fromProject, fromProject.bookPath);
    const pagesA = (await layoutHyphenated(a, fonts)).pages.length;
    const pagesB = (await layoutHyphenated(b, fonts)).pages.length;
    expect(pagesB).toBe(pagesA);
    expect(pagesA).toBeGreaterThan(0);
  });
});

describe("chapter places", () => {
  it("tells where each chapter note is and on which line its text starts", async () => {
    const p = mk({ template: true });
    const v = projectToVault(p);
    expect(v.chapterPaths.one).toBe("Chapters/Chapter One.md");
    expect(v.chapterPaths.dedication).toBe("Dedication.md");
    for (const c of p.chapters) {
      const lines = (await v.read(v.chapterPaths[c.id])).split("\n");
      expect(lines[bodyStartLine(c) - 1]).toBe(c.body.split("\n")[0]);
    }
  });
});
