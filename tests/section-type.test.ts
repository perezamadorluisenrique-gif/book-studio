// A chapter note may say `section: dedication` (the Starter Book does); the engine must not crash on a type it does not know.
import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { projectToVault } from "../src/project/to-vault";
import { createProject } from "../src/project/ops";

describe("unknown section types", () => {
  it("falls back to the title or to other instead of failing", async () => {
    const p = createProject({ id: "p", name: "Starter", now: 1, template: true });
    const v = projectToVault(p);
    const book = await loadBook(v, v.bookPath);
    expect(book.chapters.map((c) => c.type)).toEqual(["other", "chapter", "chapter", "chapter", "other"]);
  });
});
