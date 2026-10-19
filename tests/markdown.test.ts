import { describe, expect, it } from "vitest";
import { parseMarkdown, splitFrontmatter, type ParseContext } from "../src/engine/markdown";

function ctx(): ParseContext {
  let n = 0;
  return { file: "Note.md", lang: "en", smart: true, nextId: () => `b${++n}`, resolve: () => null, readNote: async () => "", warnings: [] };
}

describe("splitFrontmatter", () => {
  it("reads YAML and blanks its lines so source lines still match", () => {
    const { frontmatter, body } = splitFrontmatter("---\ntitle: Dawn\nyear: 1900\ntags: [a, b]\n---\nText");
    expect(frontmatter).toEqual({ title: "Dawn", year: 1900, tags: ["a", "b"] });
    expect(body).toBe("\n\n\n\n\nText");
  });

  it("treats broken YAML as no frontmatter", () => {
    expect(splitFrontmatter("---\ntitle: [unclosed\nx: :\n---\nText").frontmatter).toEqual({});
  });

  it("drops control characters that would print as boxes", () => {
    expect(splitFrontmatter("A\u0001B\u000bC\r\nD\u007f").body).toBe("AB C\nD");
  });
});

describe("scene and page breaks", () => {
  it.each(["* * *", "***", "---", "# # #", "~ ~ ~", "#", "⁂", "❦"])("reads %j as a scene break", async (marker) => {
    const { blocks } = await parseMarkdown(`Before.\n\n${marker}\n\nAfter.`, ctx());
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "sceneBreak", "paragraph"]);
  });

  it.each(["\\pagebreak", "\\newpage", "<!-- pagebreak -->"])("reads %j as a page break", async (marker) => {
    const { blocks } = await parseMarkdown(`Before.\n\n${marker}\n\nAfter.`, ctx());
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("keeps real headings", async () => {
    const { blocks } = await parseMarkdown("# The Road\n\nText.", ctx());
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
  });
});
