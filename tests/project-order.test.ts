// Tests for putting chapters in order: move() one place and reorder() to any place, also across sections.
import { describe, expect, it } from "vitest";
import { addChapter, bookOrder, createProject, locate, move, reorder, sectionIds } from "../src/project/ops";

const starter = () => createProject({ id: "p", name: "Book", now: 1, template: true });
// dedication | one two three | about

describe("reorder", () => {
  it("moves a chapter inside its section", () => {
    const p = reorder(starter(), "one", "body", 2, 5);
    expect(sectionIds(p, "body")).toEqual(["two", "three", "one"]);
    expect(p.updatedAt).toBe(5);
  });

  it("counts the place after the chapter is taken out", () => {
    expect(sectionIds(reorder(starter(), "three", "body", 0, 2), "body")).toEqual(["three", "one", "two"]);
    expect(sectionIds(reorder(starter(), "one", "body", 1, 2), "body")).toEqual(["two", "one", "three"]);
  });

  it("treats a place that is too big as the end and a negative one as the start", () => {
    expect(sectionIds(reorder(starter(), "one", "body", 99, 2), "body")).toEqual(["two", "three", "one"]);
    expect(sectionIds(reorder(starter(), "three", "body", -4, 2), "body")).toEqual(["three", "one", "two"]);
  });

  it("moves a chapter to another section", () => {
    const p = reorder(starter(), "about", "body", 1, 2);
    expect(sectionIds(p, "body")).toEqual(["one", "about", "two", "three"]);
    expect(p.sections.map((s) => s.kind)).toEqual(["front", "body"]);
  });

  it("creates a section that does not exist yet, in the right order", () => {
    const p = reorder(createProject({ id: "p", name: "B", now: 1 }), "c1", "front", 0, 2);
    expect(p.sections).toEqual([{ kind: "front", chapterIds: ["c1"] }]);
    const q = addChapter(createProject({ id: "p", name: "B", now: 1 }), "body", "Two", 2);
    expect(reorder(q, "c2", "back", 0, 3).sections.map((s) => s.kind)).toEqual(["body", "back"]);
  });

  it("returns the same project when nothing changes or the chapter is unknown", () => {
    const p = starter();
    expect(reorder(p, "one", "body", 0, 9)).toBe(p);
    expect(reorder(p, "nope", "body", 0, 9)).toBe(p);
  });

  it("does not change the original project or the chapters", () => {
    const p = starter();
    const before = JSON.stringify(p);
    const q = reorder(p, "one", "back", 0, 9);
    expect(JSON.stringify(p)).toBe(before);
    expect(q.chapters).toBe(p.chapters);
  });
});

describe("move", () => {
  it("swaps with the neighbour inside a section", () => {
    expect(sectionIds(move(starter(), "two", -1, 2), "body")).toEqual(["two", "one", "three"]);
    expect(sectionIds(move(starter(), "two", 1, 2), "body")).toEqual(["one", "three", "two"]);
  });

  it("goes into the next or the previous section at the edge", () => {
    const down = move(starter(), "three", 1, 2);
    expect(sectionIds(down, "body")).toEqual(["one", "two"]);
    expect(sectionIds(down, "back")).toEqual(["three", "about"]);
    const up = move(starter(), "one", -1, 2);
    expect(sectionIds(up, "front")).toEqual(["dedication", "one"]);
    expect(locate(up, "one")).toEqual({ kind: "front", index: 1 });
  });

  it("does nothing at the very start and the very end of the book", () => {
    const p = starter();
    expect(move(p, "dedication", -1, 2)).toBe(p);
    expect(move(p, "about", 1, 2)).toBe(p);
  });

  it("keeps the order of the whole book consistent", () => {
    let p = starter();
    p = move(p, "one", 1, 2);
    p = move(p, "one", 1, 2);
    expect(bookOrder(p)).toEqual(["dedication", "two", "three", "one", "about"]);
    expect(sectionIds(p, "body")).toEqual(["two", "three", "one"]);
    // One more step crosses into the back matter, and the order of the book stays the same.
    p = move(p, "one", 1, 2);
    expect(bookOrder(p)).toEqual(["dedication", "two", "three", "one", "about"]);
    expect(sectionIds(p, "back")).toEqual(["one", "about"]);
  });

  it("creates the next section when the last chapter goes down", () => {
    const p = move(createProject({ id: "p", name: "B", now: 1 }), "c1", 1, 2);
    expect(p.sections).toEqual([{ kind: "back", chapterIds: ["c1"] }]);
  });
});
