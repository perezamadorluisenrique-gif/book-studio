// Tests for exporting a book to Word: the file opens, has the right styles, and reading it back with the
// Word import gives the same Markdown. The round trip runs on the five books of the quality bench.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { projectToDocx } from "../src/project/export-docx";
import { vaultToProjects, type ImportFiles } from "../src/project/from-vault";
import { importDocx } from "../src/project/import-docx";
import { projectFromImport, importText } from "../src/project/import-text";
import { pngHeader } from "./helpers/png";
import { BENCH_BOOKS } from "../tools/quality-books";
import { parseXml } from "./docx-helper";

const root = new URL("..", import.meta.url).pathname;

async function folderFiles(dir: string): Promise<ImportFiles> {
  const paths: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(next);
      else paths.push(next);
    }
  };
  await walk("");
  return { paths, text: async (p) => readFile(join(dir, p), "utf8"), bytes: async (p) => new Uint8Array(await readFile(join(dir, p))) };
}

/**
 * One form for Markdown that means the same: `_x_` and `*x*`, a link with or without `<>`, an Obsidian image
 * embed and a Markdown image, footnote labels in order and their texts at the end, one kind of scene break and
 * hard break and list number, no comments and no spare space.
 */
function canonical(md: string): string {
  const labels = new Map<string, number>();
  const notes: [string, string][] = [];
  let text = md
    .replace(/\r\n?/g, "\n")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/!\[\[([^\]|]+)\|([^\]]*)\]\]/g, "![$2](<$1>)")
    .replace(/!\[([^\]]*)\]\(<?[^)>]*>?\)/g, "![$1](image)")
    .replace(/\]\(<([^>]*)>\)/g, "]($1)")
    .replace(/\\([[\]])/g, "$1")
    .replace(/(^|[^\w\\])_([^_\n]+)_(?=[^\w]|$)/g, "$1*$2*")
    .replace(/(?: {2}|\\|<BR>)(?=\n\s*(?:\n|$)|\s*$)/g, "")
    .replace(/(?: {2}|\\)\n/g, "<BR>\n");
  const label = (id: string): number => {
    if (!labels.has(id)) labels.set(id, labels.size + 1);
    return labels.get(id) ?? 0;
  };
  text = text.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm, (_m, id: string, body: string) => {
    notes.push([id, body]);
    return "";
  });
  text = text.replace(/\[\^([^\]\s]+)\]/g, (_m, id: string) => `[^${label(id)}]`);
  const tail = notes.map(([id, body]) => `[^${label(id)}]: ${body}`).sort();
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+$/, "").replace(/^(\s*)\d+[.)] /, "$11. ").replace(/^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|#|~|⁂|❦)\s*$/, "* * *"));
  const body = lines.join("\n").replace(/(?:<BR>)?\n+\* \* \*(?=\n|$)/g, "\n\n* * *").replace(/\* \* \*\n(?=\S)/g, "* * *\n\n");
  return [body.replace(/\n{3,}/g, "\n\n").trim(), ...tail].join("\n\n");
}

describe("projectToDocx", () => {
  const sample = async () => {
    const imported = importText("# Dedicatoria\n\nPara ti.\n\n# Parte I: El mar\n\n## Uno\n\nHola **mundo**, *hola* y ~~tachado~~. Una nota.[^a] Un [enlace](https://example.org/x).\n\n* * *\n\n> Una cita.\n\n- uno\n- dos\n\n3. tres\n4. cuatro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Dos\n\nCentrado {.center}\n\nVerso uno  \nverso dos\n\n[^a]: La nota.\n");
    return projectFromImport({ ...imported, title: "Mi libro", author: "Ana", language: "es", subtitle: "Un viaje" }, { id: "p", now: 1 });
  };

  it("writes a Word file with Title, Heading 1, Normal, notes and a core title", async () => {
    const zip = await JSZip.loadAsync(await projectToDocx(await sample()));
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["word/document.xml", "word/styles.xml", "word/footnotes.xml", "word/numbering.xml", "docProps/core.xml"]));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('<w:pStyle w:val="Title"/>');
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain("<w:footnoteReference");
    expect(doc).toContain('<w:jc w:val="center"/>');
    expect(await zip.file("word/footnotes.xml")!.async("string")).toContain("La nota.");
    expect(await zip.file("word/styles.xml")!.async("string")).toContain('<w:name w:val="heading 1"/>');
    expect(await zip.file("docProps/core.xml")!.async("string")).toContain("<dc:title>Mi libro</dc:title>");
  });

  it("reads back as the same book", async () => {
    const p = await sample();
    const back = await importDocx(await projectToDocx(p), parseXml, "Mi libro.docx");
    expect(back.title).toBe("Mi libro");
    expect(back.author).toBe("Ana");
    expect(back.subtitle).toBe("Un viaje");
    expect(back.chapters.map((c) => [c.title, c.kind ?? ""])).toEqual(p.chapters.map((c) => [c.title, c.kind ?? ""]));
    expect(back.chapters.map((c) => canonical(c.body))).toEqual(p.chapters.map((c) => canonical(c.body)));
    expect(back.report.words.missing).toEqual([]);
  });

  it("keeps a picture, its description and its size", async () => {
    const p = await sample();
    const withImage = { ...p, assets: [{ name: "cover-art.png", mime: "image/png", data: pngHeader(40, 20) }], chapters: p.chapters.map((c) => (c.title.startsWith("Parte") ? { ...c, body: `![Una imagen](<cover-art.png>)\n\n${c.body}` } : c)) };
    const zip = await JSZip.loadAsync(await projectToDocx(withImage));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('descr="Una imagen"');
    expect(Object.keys(zip.files).some((f) => f.startsWith("word/media/"))).toBe(true);
    const back = await importDocx(await projectToDocx(withImage), parseXml, "x.docx");
    expect(back.assets).toHaveLength(1);
    expect(back.chapters.find((c) => c.body.includes("![Una imagen]"))).toBeDefined();
  });

  for (const dir of BENCH_BOOKS) {
    const name = dir.replace(/^.*\//, "");
    it(`${name}: exporting and importing gives the same Markdown`, async () => {
      const found = await vaultToProjects(await folderFiles(join(root, dir)), { now: 1, newId: () => "id" });
      expect(found.projects).toHaveLength(1);
      const p = found.projects[0];
      const back = await importDocx(await projectToDocx(p), parseXml, `${name}.docx`);
      expect(back.chapters.map((c) => c.title)).toEqual(p.chapters.map((c) => c.title));
      if (process.env.DUMP) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${process.env.DUMP}/${name}-a.md`, p.chapters.map((c) => `#### ${c.title}\n\n${canonical(c.body)}`).join("\n\n"));
        await writeFile(`${process.env.DUMP}/${name}-b.md`, back.chapters.map((c) => `#### ${c.title}\n\n${canonical(c.body)}`).join("\n\n"));
      }
      for (let k = 0; k < p.chapters.length; k++) expect(canonical(back.chapters[k].body), `${name}: ${p.chapters[k].title}`).toBe(canonical(p.chapters[k].body));
      expect(back.report.words.missing).toEqual([]);
    }, 60_000);
  }
});
