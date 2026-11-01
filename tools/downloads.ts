// Builds the site's sample downloads: for each book in sample/, the print PDF
// and the EPUB (free plan, so they show what anyone gets without paying) and a
// zip of the Markdown source folder. Every PDF must pass the KDP check, or the
// build fails and the site is not deployed. EPUBCheck runs separately
// (tools/epubcheck.sh) because it needs Java.
//
//   npm run downloads            # writes dist/web/downloads/
//   npm run downloads -- out/x   # another folder

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { buildBook, ebookBlockers, exportEpub, exportPdf, pdfBlockers } from "../src/app/pipeline";
import { FontSet } from "../src/engine/fonts";
import { isManifestFrontmatter } from "../src/engine/manifest";
import { splitFrontmatter } from "../src/engine/markdown";
import { fsVault } from "../tests/helpers/fsVault";
import { checkKdpPdf } from "./kdp-check";

const say = (line: string): void => void process.stdout.write(`${line}\n`);
const out = process.argv[2] ?? "dist/web/downloads";
const fonts = await FontSet.load(async (f) => new Uint8Array(readFileSync(new URL(`../fonts/${f}.ttf`, import.meta.url))));

export interface Download {
  id: string;
  title: string;
  author: string;
  language: string;
  trim: string;
  theme: string;
  pages: number;
  files: { kind: "pdf" | "epub" | "zip"; name: string; bytes: number }[];
}

const list: Download[] = [];
let failed = false;

for (const id of readdirSync("sample").sort()) {
  const dir = join("sample", id);
  if (!statSync(dir).isDirectory()) continue;
  const vault = fsVault(dir);
  const manifest = vault.paths.find((p) => p.endsWith(".md") && isManifestFrontmatter(splitFrontmatter(readFileSync(join(dir, p), "utf8")).frontmatter));
  if (!manifest) throw new Error(`No book note in ${dir}`);
  const built = await buildBook(vault, manifest, fonts);
  const { book, layout } = built;
  const blockers = [...pdfBlockers("free", built), ...ebookBlockers("free", built)];
  if (blockers.length) throw new Error(`${id}: the free plan can't export this book: ${blockers.map((b) => b.message).join(" ")}`);

  const target = join(out, id);
  mkdirSync(target, { recursive: true });
  const entry: Download = {
    id,
    title: book.meta.title,
    author: book.meta.authors.join(", "),
    language: book.meta.language,
    trim: layout.trim.label,
    theme: book.settings.theme,
    pages: layout.pages.length,
    files: [],
  };
  const save = (kind: Download["files"][number]["kind"], name: string, data: Uint8Array): void => {
    writeFileSync(join(target, name), data);
    entry.files.push({ kind, name, bytes: data.byteLength });
  };

  const pdf = await exportPdf(built, fonts);
  const check = await checkKdpPdf(pdf.data, layout.trim, { bleed: book.settings.bleed, insideMarginPt: layout.margins.inside });
  for (const e of check.errors) say(`  KDP error in ${id}: ${e}`);
  if (check.errors.length) failed = true;
  save("pdf", pdf.name, pdf.data);

  const epub = await exportEpub(built, fonts, "free", { claim: true });
  save("epub", epub.name, epub.data);

  const zip = new JSZip();
  const folder = zip.folder(id)!;
  for (const p of vault.paths) folder.file(p, readFileSync(join(dir, p)));
  save("zip", `${id}-markdown.zip`, await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));

  say(`${book.meta.title}: ${check.pages} pages at ${layout.trim.label}, KDP check ${check.errors.length ? "FAILED" : "passed"}.`);
  list.push(entry);
}

writeFileSync(join(out, "downloads.json"), JSON.stringify(list, null, 1));
if (failed) process.exit(1);
