// Tests for reading files saved by other programs: LibreOffice (docx, odt, rtf), pandoc, and hand-written
// XML shaped like a Google Docs export. Each file's result is saved in tests/fixtures/docx/expected/<file>.json.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { importFile } from "../src/project/import-file";
import { parseXml } from "./docx-helper";

const FILES = [
  "pandoc-novel-es.docx", "pandoc-novel-es.odt", "pandoc-novel-es.rtf",
  "pandoc-essay-en.docx", "pandoc-essay-en.odt", "pandoc-essay-en.rtf",
  "lo-novel-es.docx", "lo-novel-es.odt", "lo-novel-es.rtf",
  "lo-essay-en.docx", "lo-essay-en.odt", "lo-essay-en.rtf",
  "lo-word-like.docx", "word-like.odt", "word-like.rtf",
  "pandoc.odt", "pandoc.rtf", "spanish-patterns.odt", "spanish-patterns.rtf",
  "gdocs-novel.docx", "gdocs-notes.docx", "gdocs-plain.docx",
];

const load = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/docx/${name}`, import.meta.url)));

describe("importFile", () => {
  it.each(FILES)("%s gives the expected book and report", async (name) => {
    const r = await importFile(await load(name), parseXml, name);
    const summary = {
      title: r.title,
      author: r.author,
      subtitle: r.subtitle,
      language: r.language,
      sections: r.sections,
      chapters: r.chapters.map((c) => ({ title: c.title, kind: c.kind, body: c.body })),
      assets: r.assets.map((a) => `${a.name} ${a.mime} ${a.data.byteLength > 0 ? "bytes" : "EMPTY"}`),
      report: r.report,
    };
    await expect(JSON.stringify(summary, null, 2) + "\n").toMatchFileSnapshot(`./fixtures/docx/expected/${name}.json`);
  });

  it.each(FILES)("%s: nothing is missing except what the report says was not read", async (name) => {
    const r = await importFile(await load(name), parseXml, name);
    expect(r.chapters.length).toBeGreaterThan(0);
    expect(r.report.words.source).toBeGreaterThan(15);
    const declared = new Set(r.report.items.map((i) => i.code));
    // Pictures are not read from RTF; the pictures hold no words, so the count still has to match.
    expect(r.report.words.missing, `${name}: ${JSON.stringify(r.report.words.missing)}`).toEqual([]);
    void declared;
  });

  it("the same essay gives the same chapters from Word, OpenDocument and RTF files made by pandoc and LibreOffice", async () => {
    const titles = async (name: string) => (await importFile(await load(name), parseXml, name)).chapters.map((c) => c.title).filter((t) => t !== "Untitled");
    const expected = ["Introduction", "The Method", "Conclusion"];
    for (const name of ["pandoc-essay-en.docx", "pandoc-essay-en.odt", "lo-essay-en.docx", "lo-essay-en.odt", "lo-essay-en.rtf"]) expect(await titles(name), name).toEqual(expected);
  });

  it("keeps parts, front and back matter from a Spanish novel in every format", async () => {
    for (const name of ["pandoc-novel-es.docx", "pandoc-novel-es.odt", "lo-novel-es.docx", "lo-novel-es.odt", "lo-novel-es.rtf"]) {
      const r = await importFile(await load(name), parseXml, name);
      expect(r.chapters.filter((c) => c.kind === "part").map((c) => c.title), name).toEqual(["Parte I: La llegada", "Parte II: La partida"]);
      expect(r.chapters[0].kind, name).toBe("dedication");
      expect(r.chapters[r.chapters.length - 1].kind, name).toBe("about-the-author");
    }
  });

  it("reads the subtitle into the book's details", async () => {
    const r = await importFile(await load("gdocs-novel.docx"), parseXml, "gdocs-novel.docx");
    expect(r.subtitle).toBe("A small book of days");
    expect(r.report.words.missing).toEqual([]);
  });

  it("says plainly when the file is not what its name says", async () => {
    await expect(importFile(new Uint8Array([1, 2, 3]), parseXml, "a.odt")).rejects.toThrow("odt.notOdt");
    await expect(importFile(new TextEncoder().encode("hello"), parseXml, "a.rtf")).rejects.toThrow("rtf.notRtf");
    await expect(importFile(new Uint8Array([1, 2, 3]), parseXml, "a.docx")).rejects.toThrow("docx.notDocx");
  });
});
