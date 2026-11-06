// Tests for the editor's text edits: bold, italic, section title, scene break, footnote, quote, word count.
import { describe, expect, it } from "vitest";
import { countWords, footnote, heading, lineOffset, quote, sceneBreak, wrap } from "../src/project/edits";

const sel = (e: { text: string; start: number; end: number }) => e.text.slice(e.start, e.end);

describe("wrap", () => {
  it("makes the selection bold and keeps it selected", () => {
    const e = wrap("a big dog", 2, 5, "**");
    expect(e.text).toBe("a **big** dog");
    expect(sel(e)).toBe("big");
  });

  it("puts the cursor between two markers when nothing is selected", () => {
    const e = wrap("ab", 1, 1, "*");
    expect(e.text).toBe("a**b");
    expect(e.start).toBe(2);
    expect(e.end).toBe(2);
  });

  it("undoes itself, with the markers outside or inside the selection", () => {
    expect(wrap("a **big** dog", 4, 7, "**").text).toBe("a big dog");
    const e = wrap("a **big** dog", 2, 9, "**");
    expect(e.text).toBe("a big dog");
    expect(sel(e)).toBe("big");
  });

  it("does not take italic for the stars of bold", () => {
    expect(wrap("**big**", 2, 5, "*").text).toBe("***big***");
    expect(wrap("**big**", 0, 7, "*").text).toBe("***big***");
    expect(wrap("*big*", 1, 4, "*").text).toBe("big");
  });
});

describe("heading", () => {
  it("turns the line into a section title and back", () => {
    const e = heading("one\ntwo\nthree", 5, 5);
    expect(e.text).toBe("one\n## two\nthree");
    expect(heading(e.text, e.start, e.end).text).toBe("one\ntwo\nthree");
  });

  it("changes another heading level to a section title", () => {
    expect(heading("### x", 2, 2).text).toBe("## x");
  });

  it("works on the first line of the text", () => {
    expect(heading("\nabc", 0, 0).text).toBe("## \nabc");
    expect(heading("abc", 0, 0).text).toBe("## abc");
  });
});

describe("sceneBreak", () => {
  it("sits on its own line with a blank line each side", () => {
    expect(sceneBreak("one two", 3, 4).text).toBe("one\n\n* * *\n\ntwo");
  });

  it("does not add extra blank lines that are already there", () => {
    expect(sceneBreak("one\n\n\n\ntwo", 5, 5).text).toBe("one\n\n* * *\n\ntwo");
  });

  it("works at the start and at the end", () => {
    expect(sceneBreak("", 0, 0).text).toBe("* * *");
    expect(sceneBreak("end", 3, 3).text).toBe("end\n\n* * *");
  });

  it("puts the cursor after the break", () => {
    const e = sceneBreak("a b", 1, 2);
    expect(e.text.slice(0, e.start)).toBe("a\n\n* * *\n\n");
  });
});

describe("footnote", () => {
  it("wraps the selection as an inline note", () => {
    const e = footnote("word here", 5, 9);
    expect(e.text).toBe("word ^[here]");
    expect(sel(e)).toBe("here");
  });

  it("puts the cursor inside empty brackets", () => {
    const e = footnote("ab", 1, 1);
    expect(e.text).toBe("a^[]b");
    expect(e.start).toBe(3);
  });
});

describe("quote", () => {
  it("quotes every selected line and removes the quote again", () => {
    const e = quote("a\nb\nc", 0, 3);
    expect(e.text).toBe("> a\n> b\nc");
    expect(quote(e.text, e.start, e.end).text).toBe("a\nb\nc");
  });

  it("quotes only the line with the cursor when nothing is selected", () => {
    expect(quote("a\nb\nc", 2, 2).text).toBe("a\n> b\nc");
  });

  it("leaves blank lines alone", () => {
    expect(quote("a\n\nb", 0, 4).text).toBe("> a\n\n> b");
  });
});

describe("countWords", () => {
  it("counts words in English, Spanish and with punctuation", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  Hello,   world!\n\nNew paragraph. ")).toBe(4);
    expect(countWords("¿Qué tal, señor? * * *")).toBe(3);
    expect(countWords("It's 2026 — done")).toBe(3);
  });
});

describe("lineOffset", () => {
  it("finds where a line starts", () => {
    expect(lineOffset("ab\ncd\nef", 1)).toBe(0);
    expect(lineOffset("ab\ncd\nef", 3)).toBe(6);
    expect(lineOffset("ab\ncd", 9)).toBe(5);
  });
});
