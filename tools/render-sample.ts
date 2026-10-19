// Render a book folder to a print PDF, an EPUB and an accessibility report from
// the command line, through the same pipeline as the plugin and the web app.
//
//   npm run sample                                   # the bundled Oz sample, Pro outputs
//   npm run sample -- path/to/folder --plan free     # a folder of your own, free outputs
//   npm run sample -- --theme elegant --trim 5x8 --out out/oz
//
// The manifest is the first note whose frontmatter has `book: true`, unless
// `--manifest "Name.md"` picks one.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBook, ebookBlockers, exportEpub, exportPdf, exportReport, pdfBlockers } from "../src/app/pipeline";
import type { Plan } from "../src/engine/entitlements";
import { FontSet } from "../src/engine/fonts";
import { isManifestFrontmatter } from "../src/engine/manifest";
import { splitFrontmatter } from "../src/engine/markdown";
import type { BookSettings } from "../src/engine/model";
import { fsVault } from "../tests/helpers/fsVault";

const say = (line: string): void => void process.stdout.write(`${line}\n`);

function parseArgs(argv: string[]): { dir: string; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  let dir = "sample/oz";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) flags[a.slice(2)] = argv[++i] ?? "";
    else dir = a;
  }
  return { dir, flags };
}

const { dir, flags } = parseArgs(process.argv.slice(2));
const plan: Plan = flags.plan === "free" ? "free" : "pro";
const out = flags.out ?? "out";
const vault = fsVault(dir);

const manifest =
  flags.manifest ??
  vault.paths.find((p) => p.endsWith(".md") && isManifestFrontmatter(splitFrontmatter(readFileSync(join(dir, p), "utf8")).frontmatter));
if (!manifest) {
  process.stderr.write(`No book found in ${dir}. Add \`book: true\` to the frontmatter of the note that lists the chapters.\n`);
  process.exit(1);
}

const overrides: Partial<BookSettings> = {};
if (flags.theme) overrides.theme = flags.theme;
if (flags.trim) overrides.trim = flags.trim;

const fonts = await FontSet.load(async (f) => new Uint8Array(readFileSync(new URL(`../fonts/${f}.ttf`, import.meta.url))));
const built = await buildBook(vault, manifest, fonts, overrides);
const { book, layout, audit } = built;
say(`${book.meta.title}: ${layout.pages.length} pages at ${layout.trim.label}, built in ${built.ms} ms (${plan} plan).`);
for (const w of [...book.warnings.map((x) => ({ ...x, severity: "warning" })), ...layout.warnings]) say(`  ${w.severity}: ${w.message}`);

mkdirSync(out, { recursive: true });
const save = (name: string, data: Uint8Array | string) => {
  writeFileSync(join(out, name), data);
  say(`  wrote ${join(out, name)}`);
};
const choices = { claim: true };

const pdfBlocked = pdfBlockers(plan, built);
if (pdfBlocked.length) say(`  print PDF skipped: ${pdfBlocked.map((b) => b.message).join(" ")}`);
else {
  const pdf = await exportPdf(built, fonts);
  save(pdf.name, pdf.data);
}

const epubBlocked = ebookBlockers(plan, built);
if (epubBlocked.length) say(`  EPUB skipped: ${epubBlocked.map((b) => b.message).join(" ")}`);
else {
  const epub = await exportEpub(built, fonts, plan, choices);
  save(epub.name, epub.data);
}

if (plan === "pro") {
  const report = exportReport(built, plan, choices);
  save(report.name, report.data);
}
say(`  accessibility: ${audit.passed ? "passes every automated check" : `${audit.issues.length} issue(s) to look at`}.`);
