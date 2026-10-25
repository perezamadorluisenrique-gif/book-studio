import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { inlineText, type Block } from "../src/engine/model";
import { memVault } from "./helpers/memVault";

const MANIFEST = "---\nbook: true\ntitle: T\nauthor: A\n---\n## Chapters\n1. [[One]]\n";
const text = (blocks: Block[]) => blocks.map((b) => (b.kind === "paragraph" ? inlineText(b.inlines) : b.kind)).join("|");

describe("embedded notes", () => {
  it("bring their footnotes, kept apart from the host note's", async () => {
    const book = await loadBook(
      memVault({
        "Book.md": MANIFEST,
        "One.md": "# One\nHost[^1].\n\n![[Aside]]\n\n[^1]: Host note.\n",
        "Aside.md": "Aside[^1].\n\n[^1]: Aside note.\n",
      }),
      "Book.md",
    );
    const ch = book.chapters[0];
    expect(book.warnings).toEqual([]);
    expect(ch.notes.map((n) => [text(n.blocks), n.src.file])).toEqual([
      ["Host note.", "One.md"],
      ["Aside note.", "Aside.md"],
    ]);
    expect([...book.embeds]).toEqual(["Aside.md"]);
  });

  it("leave out files that aren't notes instead of printing their bytes", async () => {
    const book = await loadBook(
      memVault({
        "Book.md": MANIFEST,
        "One.md": "# One\nBefore.\n\n![[Report.pdf]]\n\nAfter.\n",
        "Report.pdf": new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]),
      }),
      "Book.md",
    );
    expect(text(book.chapters[0].blocks)).toBe("Before.|After.");
    expect(book.warnings.map((w) => [w.message, w.src?.line])).toEqual([["Only notes and PNG or JPEG images can be embedded in a book; Report.pdf was left out.", 4]]);
    expect(book.embeds.size).toBe(0);
  });
});
