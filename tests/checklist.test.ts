// One test per rule of the publishing checklist: a book that breaks it, and the same book fixed.
import { describe, expect, it } from "vitest";
import { publishChecklist, type BuiltFacts, type CheckId } from "../src/project/checklist";
import type { Project } from "../src/project/model";
import { setCover } from "../src/project/cover-image";
import { setDetail } from "../src/project/details";
import { createProject, setChapterBody } from "../src/project/ops";

const facts: BuiltFacts = { problems: 0, missingAlt: 0, pages: 120, spine: 0.27 };
const now = 1;

/** A book that passes every required rule. */
function good(): Project {
  let p = createProject({ id: "p", name: "Faro", now });
  p = setDetail(p, "author", "Ana", now);
  p = setDetail(p, "description", "A story about a lighthouse.", now);
  p = setChapterBody(p, "c1", "Some text.", now);
  return setCover(p, new Uint8Array([1]), "image/png", now);
}
const status = (p: Project, id: CheckId, f: BuiltFacts | null = facts) => publishChecklist(p, f).items.find((i) => i.id === id)!.status;

describe("publishChecklist", () => {
  it("is ready when every required rule passes", () => {
    const r = publishChecklist(good(), facts);
    expect(r.ready).toBe(true);
    expect(r.items.filter((i) => i.status === "todo")).toEqual([]);
  });

  it.each<[CheckId, (p: Project) => Project]>([
    ["title", (p) => setDetail(p, "title", "", now)],
    ["author", (p) => setDetail(p, "author", "  ", now)],
    ["language", (p) => setDetail(p, "language", "", now)],
    ["description", (p) => setDetail(p, "description", "", now)],
    ["cover", (p) => ({ ...p, meta: { ...p.meta, cover: "" }, assets: [] })],
    ["chapters", (p) => setChapterBody(p, "c1", "   ", now)],
  ])("flags a missing %s and clears when it is fixed", (id, break_) => {
    const bad = break_(good());
    expect(status(bad, id)).toBe("todo");
    expect(publishChecklist(bad, facts).ready).toBe(false);
    expect(status(good(), id)).toBe("ok");
  });

  it("counts the empty chapters", () => {
    const p = setChapterBody(good(), "c1", "", now);
    expect(publishChecklist(p, facts).items.find((i) => i.id === "chapters")!.n).toBe(1);
  });

  it("flags problems and pictures without a description from the built book", () => {
    expect(status(good(), "problems", { ...facts, problems: 3 })).toBe("todo");
    expect(publishChecklist(good(), { ...facts, problems: 3 }).items.find((i) => i.id === "problems")!.n).toBe(3);
    expect(status(good(), "alt", { ...facts, missingAlt: 2 })).toBe("todo");
  });

  it("keeps the built-book rules as to-do while the book is not built", () => {
    expect(status(good(), "problems", null)).toBe("todo");
    expect(status(good(), "alt", null)).toBe("todo");
  });

  it("treats keywords and ISBN as tips that do not block", () => {
    const r = publishChecklist(good(), facts);
    expect(r.items.find((i) => i.id === "keywords")!.status).toBe("tip");
    expect(r.items.find((i) => i.id === "isbn")!.status).toBe("tip");
    expect(r.ready).toBe(true);
    const p = setDetail(setDetail(good(), "keywords", "a, b", now), "isbnPrint", "9780306406157", now);
    expect(status(p, "keywords")).toBe("ok");
    expect(status(p, "isbn")).toBe("ok");
  });
});
