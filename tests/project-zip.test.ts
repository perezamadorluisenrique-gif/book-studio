// Tests for the backup zip: a book goes into a zip and comes back the same, the zip is a normal folder of
// notes (so Obsidian and "Open a folder" can read it), and an Obsidian folder can become a project.
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { createResolver } from "../src/engine/resolve";
import { backupDue } from "../src/project/backup";
import { vaultToProjects, splitChapterNote } from "../src/project/from-vault";
import { addChapter, createProject, setChapterBody } from "../src/project/ops";
import { setCover } from "../src/project/cover-image";
import { projectToVault } from "../src/project/to-vault";
import { exportZip, filesFromZip, importZip, zipName } from "../src/project/zip";
import { fsVault } from "./helpers/fsVault";
import { pngHeader } from "./helpers/png";

const opts = { now: 99, newId: () => "new" };

async function allFiles(p: ReturnType<typeof projectToVault>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of p.paths) out[path] = path.endsWith(".md") ? await p.read(path) : String((await p.readBinary(path)).length);
  return out;
}

describe("backup zip", () => {
  it("brings a book back identical (texts byte for byte)", async () => {
    let p = createProject({ id: "a", name: "Starter Book", now: 1, template: true });
    p = addChapter(p, "body", "Part 1: Start?", 2);
    p = setChapterBody(p, "c6", "Línea con acentos: ñ, “comillas”.\n\n* * *\n\nOtra.", 3);
    p = setCover(p, pngHeader(1800, 2700), "image/png", 4);
    p = { ...p, meta: { ...p.meta, keywords: "a, b", isbn: "9780306406157" }, settings: { ...p.settings, "scene-break": "***" } };
    const { projects, missing } = await importZip(await exportZip(p), opts);
    expect(missing).toEqual([]);
    expect(projects).toHaveLength(1);
    const back = projects[0];
    expect(back.name).toBe("Starter Book");
    expect(await allFiles(projectToVault(back))).toEqual(await allFiles(projectToVault(p)));
    expect(back.chapters.map((c) => c.kind)).toEqual(p.sections.flatMap((s) => s.chapterIds).map((id) => p.chapters.find((c) => c.id === id)?.kind));
  });

  it("gives the same bytes for the same book", async () => {
    const p = createProject({ id: "a", name: "Same", now: 1, template: true });
    expect(Buffer.from(await exportZip(p)).equals(Buffer.from(await exportZip(p)))).toBe(true);
  });

  it("is a normal folder of notes that the book engine can load", async () => {
    const p = createProject({ id: "a", name: "Starter Book", now: 1, template: true });
    const dir = await mkdtemp(join(tmpdir(), "bs-zip-"));
    const zip = await JSZip.loadAsync(await exportZip(p));
    for (const f of Object.values(zip.files)) {
      if (f.dir) continue;
      await mkdir(join(dir, f.name, ".."), { recursive: true });
      await writeFile(join(dir, f.name), await f.async("uint8array"));
    }
    const book = await loadBook(fsVault(dir), "Starter Book.md");
    expect(book.meta.title).toBe("Starter Book");
    expect(book.chapters.length).toBe(5);
  });

  it("names the file after the book", () => {
    expect(zipName({ ...createProject({ id: "a", name: "A/B: C", now: 1 }) })).toBe("A-B- C.zip");
  });

  it("skips hidden and system files", async () => {
    const zip = new JSZip();
    zip.file("Book.md", "---\nbook: true\n---\n");
    zip.file("__MACOSX/._Book.md", "x");
    zip.file(".hidden/app.json", "{}");
    const files = await filesFromZip(await zip.generateAsync({ type: "uint8array" }));
    expect(files.paths).toEqual(["Book.md"]);
  });
});

describe("folder to projects", () => {
  const files = (m: Record<string, string>) => ({
    paths: Object.keys(m),
    text: async (p: string) => m[p],
    bytes: async (p: string) => new TextEncoder().encode(m[p]),
  });

  it("reads an Obsidian book: sections, aliases, missing notes, details and settings", async () => {
    const r = await vaultToProjects(
      files({
        "My Book.md": "---\nbook: true\ntitle: My Book\nauthor: Ana\ntheme: modern\ntrim: 5x8\neditions:\n  a:\n    b: 1\n---\n## Front matter\n- [[Foreword]]\n## Chapters\n### Part One\n1. [[Notes/One]]\n2. [[Two|Second]]\n3. [[Ghost]]\n## Back matter\n- [[Thanks]]\n",
        "Foreword.md": "Hello.\n",
        "Notes/One.md": "# First\n\nText one.\n",
        "Two.md": "Plain text, no heading.\n",
        "Thanks.md": "---\nsection: acknowledgments\n---\n# Thanks\n\nTo you.\n",
        "images/pic.png": "png",
      }),
      opts,
    );
    expect(r.missing).toEqual(["Ghost"]);
    expect(r.skipped).toEqual(["editions"]);
    const p = r.projects[0];
    expect(p.settings).toEqual({ theme: "modern", trim: "5x8" });
    expect(p.meta).toEqual({ title: "My Book", author: "Ana" });
    expect(p.chapters.map((c) => [c.title, c.body])).toEqual([
      ["Foreword", "Hello."],
      ["First", "Text one."],
      ["Second", "Plain text, no heading."],
      ["Thanks", "To you."],
    ]);
    expect(p.sections.map((s) => [s.kind, s.chapterIds.length])).toEqual([["front", 1], ["body", 2], ["back", 1]]);
    expect(p.chapters[3].kind).toBe("acknowledgments");
    expect(p.assets.map((a) => a.name)).toEqual(["pic.png"]);
  });

  it("makes one project per book note and none when there is no book", async () => {
    const m = { "A.md": "---\nbook: true\n---\n- [[X]]\n", "B.md": "---\nbook: true\n---\n- [[X]]\n", "X.md": "x" };
    expect((await vaultToProjects(files(m), opts)).projects.map((p) => p.name)).toEqual(["A", "B"]);
    expect((await vaultToProjects(files({ "X.md": "x" }), opts)).projects).toEqual([]);
  });

  it("splits a chapter note into section, title and text", () => {
    expect(splitChapterNote("---\nsection: x\n---\n# T\n\nBody\n\n")).toEqual({ section: "x", title: "T", body: "Body" });
    expect(splitChapterNote("\n\nJust text\n")).toEqual({ section: undefined, body: "Just text" });
    expect(splitChapterNote("# Only a title\n")).toEqual({ section: undefined, title: "Only a title", body: "" });
    // resolver sanity: nothing here depends on it
    expect(createResolver(["a.md"])("a", "b.md")).toBe("a.md");
  });
});

describe("backup reminder", () => {
  const DAY = 86_400_000;
  it("asks only for a changed book whose last copy (or first sight) is over 7 days old", () => {
    const now = 100 * DAY;
    expect(backupDue(now, { firstSeen: now - DAY, updatedAt: now })).toBe(false);
    expect(backupDue(now, { firstSeen: now - 8 * DAY, updatedAt: now - DAY })).toBe(true);
    expect(backupDue(now, { lastBackup: now - 2 * DAY, firstSeen: 0, updatedAt: now })).toBe(false);
    expect(backupDue(now, { lastBackup: now - 8 * DAY, firstSeen: 0, updatedAt: now - 9 * DAY })).toBe(false);
    expect(backupDue(now, { lastBackup: now - 8 * DAY, firstSeen: 0, updatedAt: now - DAY })).toBe(true);
  });
});
