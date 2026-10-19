import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { partHeading } from "../src/engine/i18n";
import { memVault } from "./helpers/memVault";

const vault = memVault({
  "Box.md": "---\nbook: true\ntitle: The Complete Trilogy\nauthor: Jane Doe\n---\n## Chapters\n- [[One/Book One]]\n- [[Two/Book Two]]\n## Back matter\n- [[Afterword]]\n",
  "One/Book One.md": "---\nbook: true\ntitle: Dawn\nsubtitle: A Beginning\n---\n## Front matter\n- [[Foreword]]\n## Chapters\n### Part One: Morning\n1. [[A1]]\n2. [[A2]]\n",
  "One/Foreword.md": "Before it all.",
  "One/A1.md": "# Waking\nText.",
  "One/A2.md": "# Rising\nText.",
  "Two/Book Two.md": "---\nbook: true\ntitle: Dusk\n---\n## Chapters\n1. [[B1]]\n",
  "Two/B1.md": "# Falling\nText.",
  "Afterword.md": "After it all.",
});

describe("box sets", () => {
  it("reads each linked book as a volume with its own chapter numbers", async () => {
    const book = await loadBook(vault, "Box.md", {}, { boxSets: true });
    const outline = book.chapters.map((c) => [c.type, c.titleText, c.matter, c.number ?? c.partNumber ?? null]);
    expect(outline).toEqual([
      ["part", "Dawn", "body", 1],
      ["foreword", "Foreword", "body", null],
      ["chapter", "Waking", "body", 1],
      ["chapter", "Rising", "body", 2],
      ["part", "Dusk", "body", 2],
      ["chapter", "Falling", "body", 1],
      ["afterword", "Afterword", "back", null],
    ]);
    expect(book.chapters[0].subtitle).toBe("A Beginning");
    expect(partHeading(book.chapters[0], "en")).toEqual({ label: "Book One", full: "Book One: Dawn" });
    expect(book.warnings.filter((w) => /book of its own/.test(w.message))).toEqual([]);
  });

  it("leaves volumes out with a warning when box sets aren't enabled", async () => {
    const book = await loadBook(vault, "Box.md");
    expect(book.chapters.map((c) => c.titleText)).toEqual(["Afterword"]);
    expect(book.warnings.map((w) => w.message)).toContain("One/Book One is a book of its own. Box sets are part of Book Studio Pro; it was left out.");
  });
});

describe("partHeading", () => {
  it("labels parts unless the title already does", () => {
    expect(partHeading({ titleText: "The Sea", partNumber: 2 }, "en").full).toBe("Part Two: The Sea");
    expect(partHeading({ titleText: "Part 3", partNumber: 3 }, "en")).toEqual({ label: null, full: "Part 3" });
    expect(partHeading({ titleText: "Book of Shadows", partNumber: 1, volume: true }, "en").label).toBe("Book One");
    expect(partHeading({ titleText: "El mar", partNumber: 1 }, "es").label).toBe("Parte Uno");
  });
});
