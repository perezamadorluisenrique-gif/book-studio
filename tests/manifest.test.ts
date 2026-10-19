import { describe, expect, it } from "vitest";
import { isManifestFrontmatter, manifestTemplate, parseManifest } from "../src/engine/manifest";

const MANIFEST = `---
book: true
title: Dawn
trim: 5.5 x 8.5 in
theme: elegant
chapters-start: any
---
Notes about the book are ignored.

## Front matter
- [[Foreword]]

## Chapters
### Part One: Morning
1. [[Waking|The Waking]]
2. ~~[[Draft chapter]]~~
3. [Rising](Rising.md) (unnumbered)
%% - [[Hidden]] %%

## Back matter
- [[Afterword]]
`;

describe("manifest", () => {
  it("reads sections, parts, aliases and struck-out drafts", () => {
    const m = parseManifest(MANIFEST);
    expect(m.entries.map((e) => (e.kind === "part" ? `part:${e.title}` : `${e.matter}:${e.target}${e.title ? `=${e.title}` : ""}${e.unnumbered ? " (u)" : ""}`))).toEqual([
      "front:Foreword",
      "part:Part One: Morning",
      "body:Waking=The Waking",
      "body:Rising.md (u)",
      "back:Afterword",
    ]);
  });

  it("reads layout settings in the spellings people write", () => {
    const { settings } = parseManifest(MANIFEST);
    expect(settings).toMatchObject({ trim: "5.5x8.5", theme: "elegant" });
  });

  it("recognizes a book note by its frontmatter", () => {
    expect(isManifestFrontmatter({ book: true })).toBe(true);
    expect(isManifestFrontmatter({ type: "Book" })).toBe(true);
    expect(isManifestFrontmatter({ title: "Just a note" })).toBe(false);
  });

  it("writes a starter manifest that parses back to the same chapters", () => {
    const text = manifestTemplate("Dawn", "Ada", ["One", "Two", "Three"]);
    const m = parseManifest(text);
    expect(isManifestFrontmatter(m.frontmatter)).toBe(true);
    expect(m.entries.filter((e) => e.kind === "chapter").map((e) => (e.kind === "chapter" ? e.target : ""))).toEqual(["One", "Two", "Three"]);
  });
});
