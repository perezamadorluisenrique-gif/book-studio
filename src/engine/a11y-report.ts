// The accessibility report: a standalone HTML page the author keeps with the
// EPUB. It lists what the audit checked, what it found, the metadata the EPUB
// carries, and what a person still has to confirm.

import type { AuditIssue, AuditResult } from "./a11y";
import type { Book } from "./model";

export interface ReportOptions {
  /** The EPUB carries a conformance claim. */
  claimed: boolean;
  certifiedBy?: string;
  /** The EPUB has the print page list. */
  pageList: boolean;
  generated?: Date;
  generator?: string;
}

const WCAG_URL: Record<string, string> = {
  "1.1.1": "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content",
  "1.3.1": "https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships",
  "2.4.2": "https://www.w3.org/WAI/WCAG21/Understanding/page-titled",
  "2.4.4": "https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context",
  "3.1.1": "https://www.w3.org/WAI/WCAG21/Understanding/language-of-page",
};

function h(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const SEVERITY_LABEL = { error: "Must fix", warning: "Should fix", info: "Suggestion" } as const;

function issueItem(i: AuditIssue): string {
  const where = i.src ? `<span class="where">${h(i.src.file)}, line ${i.src.line}</span>` : "";
  const wcag = i.wcag ? ` <a href="${WCAG_URL[i.wcag] ?? "https://www.w3.org/TR/WCAG21/"}">WCAG ${h(i.wcag)}</a>` : "";
  const fix = i.fix ? `<p class="fix">${h(i.fix)}</p>` : "";
  return `<li class="${i.severity}"><p><strong>${SEVERITY_LABEL[i.severity]}:</strong> ${h(i.message)}${wcag}</p>${fix}${where}</li>`;
}

export function accessibilityReport(book: Book, audit: AuditResult, opts: ReportOptions): string {
  const { meta } = book;
  const date = (opts.generated ?? new Date()).toISOString().slice(0, 10);
  const errors = audit.issues.filter((i) => i.severity === "error");
  const warnings = audit.issues.filter((i) => i.severity === "warning");
  const infos = audit.issues.filter((i) => i.severity === "info");
  const lang = meta.language || "en";

  const verdict = audit.passed
    ? opts.claimed
      ? `The EPUB passed every automated check and declares conformance to <strong>EPUB Accessibility 1.1, WCAG 2.1 Level AA</strong>${opts.certifiedBy ? `, certified by ${h(opts.certifiedBy)}` : ""}.`
      : "The EPUB passed every automated check. It makes no conformance claim because you chose not to certify it."
    : `The EPUB has ${errors.length} problem${errors.length === 1 ? "" : "s"} that block a conformance claim, so it does not declare one. Fix them and export again.`;

  const metaRows: [string, string][] = [
    ["Access modes", audit.accessMode.join(", ")],
    ["Sufficient access modes", audit.accessModeSufficient.join("; ")],
    ["Features", audit.accessibilityFeature.join(", ")],
    ["Hazards", audit.accessibilityHazard.join(", ")],
    ["Summary", meta.accessibilitySummary ?? audit.summary],
  ];
  if (opts.claimed) metaRows.push(["Conforms to", "EPUB Accessibility 1.1 - WCAG 2.1 Level AA"]);

  const imageRows = audit.images
    .map((img) => {
      const status = !img.ok ? '<span class="bad">Needs attention</span>' : img.decorative ? "Decorative (no description needed)" : '<span class="good">Described</span>';
      const alt = img.decorative ? "<em>none (decorative)</em>" : img.alt ? h(img.alt) : "<em>missing</em>";
      const where = img.src ? `${h(img.src.file)}, line ${img.src.line}` : "Manifest (cover)";
      return `<tr><th scope="row">${h(img.target)}</th><td>${alt}</td><td>${status}</td><td>${where}</td></tr>`;
    })
    .join("\n");

  const section = (title: string, list: AuditIssue[]) => (list.length ? `<h3>${title} (${list.length})</h3>\n<ul class="issues">${list.map(issueItem).join("\n")}</ul>` : "");
  const s = audit.stats;

  return `<!DOCTYPE html>
<html lang="${h(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility report: ${h(meta.title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #ffffff; --muted: #5a5a60; --line: #d8d8dc; --bad: #b3261e; --warn: #8a5300; --good: #1e6b34; --link: #0b57d0; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececf0; --bg: #17171a; --muted: #a8a8b0; --line: #3a3a40; --bad: #ff8a80; --warn: #ffc56b; --good: #7ad694; --link: #8ab4f8; } }
body { font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); max-width: 52rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
h1 { font-size: 1.7rem; line-height: 1.25; margin-bottom: 0.25rem; }
h2 { font-size: 1.25rem; margin-top: 2.2rem; border-bottom: 1px solid var(--line); padding-bottom: 0.3rem; }
h3 { font-size: 1.05rem; margin-top: 1.5rem; }
a { color: var(--link); }
.meta { color: var(--muted); margin-top: 0; }
.verdict { border-left: 4px solid ${audit.passed ? "var(--good)" : "var(--bad)"}; padding: 0.6rem 1rem; background: color-mix(in srgb, var(--fg) 5%, transparent); }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { text-align: left; vertical-align: top; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--line); }
thead th { border-bottom: 2px solid var(--line); }
tbody th { font-weight: 600; }
.issues { padding-left: 1.2rem; }
.issues li { margin-bottom: 0.9rem; }
.issues p { margin: 0; }
.issues .fix { color: var(--muted); }
.issues .where, .stats { color: var(--muted); font-size: 0.9rem; }
li.error strong, .bad { color: var(--bad); }
li.warning strong { color: var(--warn); }
.good { color: var(--good); }
.checklist li { margin-bottom: 0.5rem; }
</style>
</head>
<body>
<header>
<h1>Accessibility report: ${h(meta.title)}</h1>
<p class="meta">${h(meta.authors.join(", ") || "Unknown author")} · Generated ${date}${opts.generator ? ` by ${h(opts.generator)}` : ""}</p>
</header>
<main>
<p class="verdict">${verdict}</p>
<p class="stats">${count(s.chapters, "section")}, ${count(s.headings, "subheading")}, ${count(s.images, "image")} (${s.decorative} decorative), ${count(s.tables, "table")}, ${count(s.notes, "note")}, ${count(s.links, "link")}.</p>

<h2>Findings</h2>
${audit.issues.length ? section("Must fix", errors) + section("Should fix", warnings) + section("Suggestions", infos) : "<p>No problems found.</p>"}

<h2>Image descriptions</h2>
${
  audit.images.length
    ? `<p>Read each description and check that it tells a reader who cannot see the image what it shows and why it is there.</p>
<table>
<thead><tr><th scope="col">Image</th><th scope="col">Description</th><th scope="col">Status</th><th scope="col">Where</th></tr></thead>
<tbody>
${imageRows}
</tbody>
</table>`
    : "<p>The book has no images.</p>"
}

<h2>Accessibility metadata in the EPUB</h2>
<table>
<tbody>
${metaRows.map(([k, v]) => `<tr><th scope="row">${h(k)}</th><td>${h(v)}</td></tr>`).join("\n")}
</tbody>
</table>

<h2>What Book Studio builds in</h2>
<ul>
<li>Semantic XHTML: sections with EPUB structural semantics and DPUB-ARIA roles, real headings, lists and tables.</li>
<li>A navigation document with the table of contents and landmarks${opts.pageList ? ", plus the print edition’s page numbers as a page list" : ""}.</li>
<li>The reading order follows your manifest; nothing is positioned out of order.</li>
<li>Notes link to their references and back.</li>
<li>Reflowable text with no fixed sizes, so readers can change the font, size and colors.</li>
<li>The book’s language is declared on every document.</li>
</ul>

<h2>Check these yourself</h2>
<p>Automated checks cannot judge meaning. Before you rely on the conformance claim, confirm:</p>
<ol class="checklist">
<li>Every image description is accurate and useful in context (WCAG 1.1.1).</li>
<li>Passages in another language are rare, or you accept that screen readers will read them in the book’s language (WCAG 3.1.2).</li>
<li>Link text makes sense out of context (WCAG 2.4.4).</li>
<li>No image relies on color alone to convey meaning (WCAG 1.4.1).</li>
<li>Tables are simple, with one header row (WCAG 1.3.1).</li>
</ol>
<p>Read more: <a href="https://www.w3.org/TR/epub-a11y-11/">EPUB Accessibility 1.1</a> · <a href="https://www.w3.org/TR/WCAG21/">WCAG 2.1</a> · <a href="https://daisy.org/activities/software/ace/">DAISY Ace</a>, a free checker you can run on the EPUB.</p>
</main>
</body>
</html>
`;
}
