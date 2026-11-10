// Tests for importing Word files. Each fixture in tests/fixtures/docx is turned into Markdown and a
// report, and compared with the saved result in tests/fixtures/docx/expected/.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { importDocx } from "../src/project/import-docx";
import { parseXml } from "./docx-helper";

const load = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/docx/${name}.docx`, import.meta.url)));
const FIXTURES = ["word-like", "pandoc", "libreoffice", "spanish-patterns", "tracked-and-extras"];

describe("importDocx", () => {
  it.each(FIXTURES)("%s gives the expected Markdown, chapters and report", async (name) => {
    const r = await importDocx(await load(name), parseXml, `${name}.docx`);
    const summary = {
      title: r.title,
      author: r.author,
      language: r.language,
      sections: r.sections,
      chapters: r.chapters.map((c) => ({ title: c.title, kind: c.kind, body: c.body })),
      assets: r.assets.map((a) => `${a.name} ${a.mime} ${a.data.byteLength > 0 ? "bytes" : "EMPTY"}`),
      report: r.report,
    };
    await expect(JSON.stringify(summary, null, 2) + "\n").toMatchFileSnapshot(`./fixtures/docx/expected/${name}.json`);
  });

  it.each(FIXTURES)("%s: words missing from the book are only what the report already says was left out", async (name) => {
    const r = await importDocx(await load(name), parseXml, `${name}.docx`);
    const declared = new Set(r.report.items.map((i) => i.code));
    if (r.report.words.missing.length) expect(["tables", "textBoxes", "equations"].some((c) => declared.has(c as never))).toBe(true);
    expect(r.report.words.source).toBeGreaterThan(0);
  });

  it("rejects a file that is not a .docx", async () => {
    await expect(importDocx(new Uint8Array([1, 2, 3]), parseXml)).rejects.toThrow("docx.notDocx");
  });

  it("rejects a zip that has no Word document", async () => {
    const { default: JSZip } = await import("jszip");
    const z = new JSZip();
    z.file("hello.txt", "hi");
    await expect(importDocx(await z.generateAsync({ type: "uint8array" }), parseXml)).rejects.toThrow("docx.notDocx");
  });
});
