// Tests for splitting a Markdown or plain-text manuscript into chapters.
import { describe, expect, it } from "vitest";
import { importText, projectFromText } from "../src/project/import-text";

const titles = (t: string, f?: string) => importText(t, f).chapters.map((c) => c.title);

describe("importText", () => {
  it("splits on level-1 headings", () => {
    const r = importText("# One\n\nHello.\n\n# Two\n\nWorld.\n");
    expect(r.chapters).toEqual([
      { id: "c1", title: "One", body: "Hello." },
      { id: "c2", title: "Two", body: "World." },
    ]);
    expect(r.sections).toEqual([{ kind: "body", chapterIds: ["c1", "c2"] }]);
  });

  it("treats a lone # as the book title and ## as chapters", () => {
    const r = importText("# My Book\n\n## A\n\nx\n\n## B\n\ny");
    expect(r.title).toBe("My Book");
    expect(r.chapters.map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("reads front matter and ignores # inside code fences", () => {
    const r = importText("---\ntitle: \"El libro\"\nauthor: Ana\nlanguage: es\n---\n# Uno\n\n```\n# not a heading\n```\n\n# Dos\n\nfin");
    expect(r).toMatchObject({ title: "El libro", author: "Ana", language: "es" });
    expect(r.chapters.map((c) => c.title)).toEqual(["Uno", "Dos"]);
    expect(r.chapters[0].body).toContain("# not a heading");
  });

  it.each([
    ["English", "Chapter 1\n\nText a.\n\nChapter 2: The road\n\nText b.\n\nCHAPTER III\n\nText c.", ["Chapter 1", "Chapter 2: The road", "CHAPTER III"]],
    ["Spanish", "Capítulo 1\n\nTexto.\n\nCapítulo dos. El viaje\n\nMás texto.\n\nCAPÍTULO IV\n\nFin.", ["Capítulo 1", "Capítulo dos. El viaje", "CAPÍTULO IV"]],
  ])("splits plain text on %s chapter lines", (_n, text, expected) => {
    expect(titles(text)).toEqual(expected);
  });

  it("does not split on a sentence that starts with Chapter", () => {
    expect(titles("Intro line.\n\nChapter 3 shows that the plan was always going to fail, and here is why that matters to us all.\n")).toEqual(["Untitled"]);
  });

  it("makes one chapter named after the file when there is nothing to split on", () => {
    const r = importText("Just some words.\n\nMore words.", "mi novela.txt");
    expect(r.chapters).toEqual([{ id: "c1", title: "mi novela", body: "Just some words.\n\nMore words." }]);
    expect(r.title).toBe("mi novela");
  });

  it("keeps text before the first chapter as its own chapter and says so", () => {
    const r = importText("Preface text.\n\n# One\n\nx");
    expect(r.chapters.map((c) => c.title)).toEqual(["Untitled", "One"]);
    expect(r.notes).toContain("intro");
  });

  it("places dedication in front matter and about the author at the back", () => {
    const r = importText("# Dedicatoria\n\nPara ti.\n\n# Uno\n\nx\n\n# Sobre el autor\n\nBio.");
    expect(r.sections.map((s) => s.kind)).toEqual(["front", "body", "back"]);
    expect(r.chapters[0].kind).toBe("dedication");
    expect(r.chapters[2].kind).toBe("about-the-author");
  });

  it("handles CRLF and a byte order mark", () => {
    expect(titles("﻿# A\r\n\r\nx\r\n# B\r\n\r\ny")).toEqual(["A", "B"]);
  });
});

describe("projectFromText", () => {
  it("builds a project with the given language and name", () => {
    const { project } = projectFromText("# A\n\nx", { id: "p", now: 5, language: "es", name: "Mi libro" });
    expect(project).toMatchObject({ id: "p", name: "Mi libro", updatedAt: 5, meta: { title: "Mi libro", language: "es" } });
  });
});

describe("first-book guide", () => {
  it("starts on step 1 only when asked, and old books have no guide", async () => {
    const { projectFromText } = await import("../src/project/import-text");
    const { onboardingOf } = await import("../src/project/model");
    const plain = projectFromText("# Uno\n\na\n", { id: "p1", now: 1 }).project;
    const guided = projectFromText("# Uno\n\na\n", { id: "p2", now: 1, guide: true }).project;
    expect(onboardingOf(plain)).toBe("done");
    expect(onboardingOf(guided)).toBe(1);
    expect(onboardingOf({ ...guided, onboarding: 3 })).toBe(3);
    expect(onboardingOf({ ...guided, onboarding: "done" })).toBe("done");
    // Something odd in storage never traps a person in the guide.
    expect(onboardingOf({ ...guided, onboarding: 9 as unknown as 1 })).toBe("done");
  });
});
