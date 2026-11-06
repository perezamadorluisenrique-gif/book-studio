// A backup of a book as one .zip: the same Markdown notes and images that Obsidian or "Open a folder" read
// (a book note, a note per chapter, an Images folder). The same zip can be opened again as a project.

import JSZip from "jszip";
import { vaultToProjects, type ImportFiles, type ImportResult } from "./from-vault";
import type { Project } from "./model";
import { projectToVault } from "./to-vault";

/** Stops a hostile or broken zip from filling the browser's memory. */
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SKIP = /(^|\/)(__MACOSX|\.[^/]*|node_modules)(\/|$)/;

/** The backup file name for a book ("Oz Book.zip"). */
export function zipName(p: Project): string {
  return `${p.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "book"}.zip`;
}

export async function exportZip(p: Project): Promise<Uint8Array> {
  const vault = projectToVault(p);
  const zip = new JSZip();
  // A fixed date keeps the same book giving the same bytes.
  const date = new Date(Date.UTC(2000, 0, 1));
  for (const path of vault.paths) zip.file(path, path.endsWith(".md") ? await vault.read(path) : await vault.readBinary(path), { date });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function filesFromZip(data: Uint8Array | ArrayBuffer | Blob): Promise<ImportFiles> {
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !SKIP.test(f.name));
  if (entries.length > MAX_FILES) throw new Error(`The zip has too many files (${entries.length}).`);
  const byPath = new Map(entries.map((f) => [f.name, f]));
  const need = (path: string) => {
    const f = byPath.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f;
  };
  const checked = async (path: string): Promise<Uint8Array> => {
    const bytes = await need(path).async("uint8array");
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} is too big.`);
    return bytes;
  };
  return {
    paths: [...byPath.keys()],
    text: async (path) => new TextDecoder().decode(await checked(path)),
    bytes: checked,
  };
}

/** Open a backup (or any zipped folder of notes) as book projects. */
export async function importZip(data: Uint8Array | ArrayBuffer | Blob, opts: { now: number; newId(): string }): Promise<ImportResult> {
  return vaultToProjects(await filesFromZip(data), opts);
}
