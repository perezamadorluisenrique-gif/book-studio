// Tests for saved versions (snapshots) and find/replace across a book.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { setCover } from "../src/project/cover-image";
import { addChapter, createProject, setChapterBody } from "../src/project/ops";
import { findAll, replaceAll } from "../src/project/search";
import { MAX_SNAPSHOTS, contentOf, makeSnapshot, restoreSnapshot, sameContent, toPrune, wordCount, type Snapshot } from "../src/project/snapshots";
import { deleteProject, listSnapshots, putProject, putSnapshot } from "../src/web/store";
import { pngHeader } from "./helpers/png";

const book = () => setChapterBody(createProject({ id: "p", name: "Book", now: 1, template: true }), "one", "The cat sat. A Cat is a cat; concatenate.", 2);
const opts = { matchCase: false, wholeWord: false };

describe("snapshots", () => {
  it("copies the book, so later edits cannot change a saved version", () => {
    const p = book();
    const s = makeSnapshot(p, "manual", 5, "s1", "  Draft one ");
    expect(s.name).toBe("Draft one");
    const edited = setChapterBody(p, "one", "Changed", 6);
    expect(s.content.chapters.find((c) => c.id === "one")?.body).toContain("The cat sat");
    expect(sameContent(s.content, contentOf(p))).toBe(true);
    expect(sameContent(s.content, contentOf(edited))).toBe(false);
  });

  it("restores the text, chapters and details, and keeps the pictures that exist now", () => {
    let p = book();
    const s = makeSnapshot(p, "manual", 5, "s1");
    p = addChapter(p, "body", "Extra", 6);
    p = setChapterBody(p, "one", "Rewritten", 7);
    p = setCover(p, pngHeader(1800, 2700), "image/png", 8);
    const back = restoreSnapshot(p, s, 9);
    expect(back.chapters).toEqual(s.content.chapters);
    expect(back.sections).toEqual(s.content.sections);
    expect(back.updatedAt).toBe(9);
    // The cover was added after the version: its line is not in the version, the picture stays in the book.
    expect(back.meta.cover).toBeUndefined();
    expect(back.assets).toHaveLength(1);
    // A version with a cover whose picture is gone drops the cover line.
    const withCover = makeSnapshot(p, "manual", 10, "s2");
    const gone = restoreSnapshot({ ...p, assets: [] }, withCover, 11);
    expect(gone.meta.cover).toBeUndefined();
  });

  it("keeps at most 20, deleting the oldest automatic ones before any manual one", () => {
    const mk = (n: number, kind: Snapshot["kind"]) => makeSnapshot(book(), kind, n, `s${n}`);
    const all = [mk(1, "manual"), ...Array.from({ length: 20 }, (_, i) => mk(i + 2, "export"))];
    expect(all).toHaveLength(21);
    expect(toPrune(all)).toEqual(["s2"]);
    expect(toPrune(all.slice(0, 20))).toEqual([]);
    const manual = Array.from({ length: 22 }, (_, i) => mk(i + 1, "manual"));
    expect(toPrune(manual)).toEqual(["s1", "s2"]);
    expect(MAX_SNAPSHOTS).toBe(20);
  });

  it("counts words", () => {
    expect(wordCount(contentOf(setChapterBody(createProject({ id: "w", name: "W", now: 1 }), "c1", "one two  three\nfour", 2)))).toBe(4);
  });
});

describe("find and replace", () => {
  it("counts per chapter, in titles and texts, with case and whole-word options", () => {
    const p = book();
    // In chapter one's text: The cat, A Cat, a cat, conCATenate. The title "Dedication" has one more, in its title.
    const one = (o: Parameters<typeof findAll>[2]) => findAll(p, "cat", o).chapters.find((c) => c.id === "one")?.count;
    expect(one(opts)).toBe(4);
    expect(findAll(p, "cat", opts).chapters.find((c) => c.id === "dedication")?.count).toBe(1);
    expect(one({ matchCase: true, wholeWord: false })).toBe(3);
    expect(one({ matchCase: false, wholeWord: true })).toBe(3);
    expect(one({ matchCase: true, wholeWord: true })).toBe(2);
    expect(findAll(p, "Chapter", opts).chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two", "Chapter Three"]);
    expect(findAll(p, "", opts).total).toBe(0);
  });

  it("takes the text literally", () => {
    const p = setChapterBody(book(), "one", "price $1.50 (maybe) a.b axb", 3);
    expect(findAll(p, "$1.50", opts).total).toBe(1);
    expect(findAll(p, "a.b", opts).total).toBe(1);
    const r = replaceAll(p, "(maybe)", "$& $1", opts, 4);
    expect(r.project.chapters.find((c) => c.id === "one")?.body).toBe("price $1.50 $& $1 a.b axb");
  });

  it("replaces every match, leaves the rest alone and counts", () => {
    const p = book();
    const r = replaceAll(p, "cat", "dog", { matchCase: false, wholeWord: true }, 9);
    expect(r.count).toBe(3);
    expect(r.project.chapters.find((c) => c.id === "one")?.body).toBe("The dog sat. A dog is a dog; concatenate.");
    expect(r.project.updatedAt).toBe(9);
    expect(r.project.chapters.find((c) => c.id === "two")).toBe(p.chapters.find((c) => c.id === "two"));
    const none = replaceAll(p, "zebra", "x", opts, 9);
    expect(none.count).toBe(0);
    expect(none.project).toBe(p);
  });

  it("changes titles but never leaves one empty, and handles accents and capitals", () => {
    let p = createProject({ id: "t", name: "T", now: 1 });
    p = setChapterBody(p, "c1", "Árbol, ÁRBOL y árbol.", 2);
    expect(findAll(p, "árbol", opts).total).toBe(3);
    expect(replaceAll(p, "árbol", "pino", opts, 3).project.chapters[0].body).toBe("pino, pino y pino.");
    const r = replaceAll(p, "Chapter One", "", opts, 3);
    expect(r.count).toBe(1);
    expect(r.project.chapters[0].title).toBe("Chapter One");
  });
});

describe("saved versions in the browser store", () => {
  beforeEach(async () => {
    await new Promise<void>((ok) => {
      const req = indexedDB.deleteDatabase("book-studio");
      req.onsuccess = () => ok();
      req.onerror = () => ok();
    });
  });

  it("saves, lists newest first, prunes to 20 and removes them with the book", async () => {
    const p = book();
    await putProject(p);
    await putProject({ ...p, id: "other" });
    await putSnapshot(makeSnapshot({ ...p, id: "other" }, "manual", 1, "o1"));
    await putSnapshot(makeSnapshot(p, "manual", 1, "keep-manual"));
    for (let i = 2; i <= 22; i++) await putSnapshot(makeSnapshot(p, "export", i, `e${i}`));
    const list = await listSnapshots("p");
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe("e22");
    expect(list.some((s) => s.id === "keep-manual")).toBe(true);
    expect(list.some((s) => s.id === "e2")).toBe(false);
    expect(await listSnapshots("other")).toHaveLength(1);
    await deleteProject("p");
    expect(await listSnapshots("p")).toEqual([]);
    expect(await listSnapshots("other")).toHaveLength(1);
  });

  it("upgrades a version 2 database and keeps its books", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("book-studio", 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("handles");
        req.result.createObjectStore("projects", { keyPath: "id" }).put(book());
      };
      req.onsuccess = () => (req.result.close(), resolve());
      req.onerror = () => reject(req.error ?? new Error("failed"));
    });
    expect(await listSnapshots("p")).toEqual([]);
    await putSnapshot(makeSnapshot(book(), "manual", 1, "s"));
    expect(await listSnapshots("p")).toHaveLength(1);
  });
});
