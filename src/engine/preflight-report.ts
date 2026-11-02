// The preflight report: a standalone HTML page to keep with the PDF, or to
// attach to a support question.

import { PREFLIGHT_DISCLAIMER, type PreflightFinding, type PreflightReport } from "./preflight";
import type { Book } from "./model";

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LABEL = { error: "Must fix", warning: "Should check", info: "Note" } as const;

function item(f: PreflightFinding): string {
  const where = f.page ? ` <span class="where">Page ${h(f.page)}</span>` : f.src ? ` <span class="where">${h(f.src.file)}, line ${f.src.line}</span>` : "";
  return `<li class="${f.severity}"><strong>${LABEL[f.severity]}:</strong> ${h(f.message)}${where}</li>`;
}

export function preflightReport(book: Book, report: PreflightReport, opts: { generator?: string; generated?: Date } = {}): string {
  const date = (opts.generated ?? new Date()).toISOString().slice(0, 10);
  const verdict = report.ok
    ? report.warnings
      ? `No blocking problems. ${report.warnings} thing${report.warnings === 1 ? "" : "s"} to check before you upload.`
      : "No problems found."
    : `${report.errors} problem${report.errors === 1 ? "" : "s"} KDP is likely to reject. Fix ${report.errors === 1 ? "it" : "them"} and export again.`;
  return `<!doctype html>
<html lang="${h(book.meta.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KDP preflight: ${h(book.meta.title)}</title>
<style>
:root { color-scheme: light dark; --bad: #b3261e; --warn: #8a5a00; --ok: #1b6e3a; }
body { font: 16px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.5rem; margin-bottom: .25rem; }
.sub { opacity: .75; margin-top: 0; }
.verdict { font-weight: 600; padding: .75rem 1rem; border-radius: .5rem; border: 1px solid; }
.verdict.ok { border-color: var(--ok); } .verdict.fail { border-color: var(--bad); }
ul { padding-left: 1.2rem; } li { margin: .4rem 0; }
li.error strong { color: var(--bad); } li.warning strong { color: var(--warn); } li.pass::marker { color: var(--ok); }
.where { opacity: .7; font-size: .9em; }
.fine { opacity: .75; font-size: .9em; margin-top: 2rem; }
</style>
</head>
<body>
<h1>KDP preflight</h1>
<p class="sub">${h(book.meta.title)}${book.meta.authors.length ? ` by ${h(book.meta.authors.join(", "))}` : ""} · ${report.pages} pages · ${h(date)}${opts.generator ? ` · ${h(opts.generator)}` : ""}</p>
<p class="verdict ${report.ok ? "ok" : "fail"}">${h(verdict)}</p>
${report.findings.length ? `<h2>Findings</h2>\n<ul>\n${report.findings.map(item).join("\n")}\n</ul>` : ""}
<h2>Checked and fine</h2>
<ul>
${report.passed.map((r) => `<li class="pass">${h(r.title)}</li>`).join("\n")}
</ul>
${report.skipped.length ? `<p class="fine">Not checked, because no PDF was written: ${h(report.skipped.map((r) => r.title).join("; "))}.</p>` : ""}
<p class="fine">${h(PREFLIGHT_DISCLAIMER)}</p>
</body>
</html>
`;
}
