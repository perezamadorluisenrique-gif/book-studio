// Tests for the book project data: creating, renaming, adding and removing chapters.
import { describe, expect, it } from "vitest";
import { addChapter, createProject, removeChapter, renameChapter, renameProject, setChapterBody, setMeta } from "../src/project/ops";

const base = { id: "p1", name: "My Book", now: 1000 };

describe("project ops", () => {
  it("creates an empty book with one chapter", () => {
    const p = createProject({ ...base, language: "es", firstChapterTitle: "Capítulo uno" });
    expect(p.name).toBe("My Book");
    expect(p.meta).toMatchObject({ title: "My Book", language: "es" });
    expect(p.chapters).toEqual([{ id: "c1", title: "Capítulo uno", body: "" }]);
    expect(p.sections).toEqual([{ kind: "body", chapterIds: ["c1"] }]);
    expect(p.updatedAt).toBe(1000);
  });

  it("creates a book from the Starter Book template under the chosen name", () => {
    const p = createProject({ ...base, template: true });
    expect(p.meta.title).toBe("My Book");
    expect(p.chapters.map((c) => c.title)).toEqual(["Dedication", "Chapter One", "Chapter Two", "Chapter Three", "About the author"]);
    expect(p.sections.map((s) => s.kind)).toEqual(["front", "body", "back"]);
  });

  it("uses a default name when the name is empty", () => {
    expect(createProject({ ...base, name: "   " }).name).toBe("Untitled");
  });

  it("gives each new project its own copy of the template", () => {
    const a = createProject({ ...base, template: true });
    const b = createProject({ ...base, id: "p2", template: true });
    expect(a.chapters).not.toBe(b.chapters);
    expect(a.meta).not.toBe(b.meta);
  });

  it("renames a project and its book title, without changing the old value", () => {
    const p = createProject(base);
    const q = renameProject(p, "  New name ", 2000);
    expect(q.name).toBe("New name");
    expect(q.meta.title).toBe("New name");
    expect(q.updatedAt).toBe(2000);
    expect(p.name).toBe("My Book");
    expect(renameProject(p, "  ", 3000)).toBe(p);
  });

  it("adds chapters at the end of a section, creating the section in order", () => {
    let p = createProject(base);
    p = addChapter(p, "body", "Two", 1);
    p = addChapter(p, "back", "Thanks", 2);
    p = addChapter(p, "front", "Dedication", 3);
    expect(p.sections.map((s) => s.kind)).toEqual(["front", "body", "back"]);
    expect(p.sections[1].chapterIds).toEqual(["c1", "c2"]);
    expect(new Set(p.chapters.map((c) => c.id)).size).toBe(4);
  });

  it("renames, edits and removes a chapter", () => {
    let p = addChapter(createProject(base), "body", "Two", 1);
    p = renameChapter(p, "c2", "Second", 2);
    p = setChapterBody(p, "c2", "Hello", 3);
    expect(p.chapters[1]).toMatchObject({ title: "Second", body: "Hello" });
    p = removeChapter(p, "c2", 4);
    expect(p.chapters.map((c) => c.id)).toEqual(["c1"]);
    expect(p.sections[0].chapterIds).toEqual(["c1"]);
    p = removeChapter(p, "c1", 5);
    expect(p.sections).toEqual([]);
  });

  it("does not reuse the id of a removed chapter", () => {
    let p = addChapter(createProject(base), "body", "Two", 1);
    p = removeChapter(p, "c1", 2);
    p = addChapter(p, "body", "Three", 3);
    expect(p.chapters.map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("sets a book detail", () => {
    const p = setMeta(createProject(base), "author", "Ana", 5);
    expect(p.meta.author).toBe("Ana");
    expect(p.updatedAt).toBe(5);
  });
});
