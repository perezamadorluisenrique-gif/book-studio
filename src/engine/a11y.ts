// Accessibility audit for the EPUB: what can be checked automatically against
// EPUB Accessibility 1.1 / WCAG 2.1 AA, plus the schema.org metadata values the
// book earns. The author certifies what a machine cannot judge (alt-text quality).

import type { Block, Book, ImageRef, Inline, SourceRef } from "./model";

export type Severity = "error" | "warning" | "info";

export interface AuditIssue {
  rule: string;
  severity: Severity;
  message: string;
  fix?: string;
  wcag?: string;
  src?: SourceRef;
}

export interface AuditImage {
  path: string;
  target: string;
  alt: string;
  decorative: boolean;
  ok: boolean;
  src?: SourceRef;
}

export interface AuditResult {
  issues: AuditIssue[];
  images: AuditImage[];
  stats: { chapters: number; headings: number; images: number; decorative: number; tables: number; notes: number; links: number };
  /** No errors: the book can carry a conformance claim. */
  passed: boolean;
  accessMode: string[];
  accessModeSufficient: string[];
  accessibilityFeature: string[];
  accessibilityHazard: string[];
  summary: string;
}

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{4})?(-([A-Z]{2}|\d{3}))?(-[A-Za-z0-9]{5,8})*$/;
const VAGUE_LINK = /^(click here|here|link|this link|more|read more|aqu[ií]|haz clic aqu[ií]|ici|hier)$/i;
const IMAGE_OF = /^(an? )?(image|picture|photo|photograph|graphic|imagen|foto) (of|de)\b/i;

export function auditBook(book: Book, opts: { pageList: boolean }): AuditResult {
  const issues: AuditIssue[] = [];
  const images: AuditImage[] = [];
  const stats = { chapters: 0, headings: 0, images: 0, decorative: 0, tables: 0, notes: 0, links: 0 };
  const { meta } = book;
  const manifestSrc = { file: book.manifestPath, line: 1 };

  if (!meta.title.trim()) issues.push({ rule: "meta-title", severity: "error", message: "The book has no title.", fix: "Add title: to the manifest frontmatter.", wcag: "2.4.2", src: manifestSrc });
  if (!meta.authors.length) issues.push({ rule: "meta-author", severity: "warning", message: "No author is listed.", fix: "Add author: to the manifest frontmatter.", src: manifestSrc });
  if (!LANG_RE.test(meta.language)) {
    issues.push({ rule: "meta-language", severity: "error", message: `“${meta.language}” is not a valid language tag, so screen readers may use the wrong voice.`, fix: "Use a BCP 47 tag such as en, en-GB, es or pt-BR.", wcag: "3.1.1", src: manifestSrc });
  }
  if (!meta.cover) issues.push({ rule: "cover", severity: "info", message: "No cover image. Ebook stores require one.", fix: "Add cover: images/cover.jpg to the manifest frontmatter." });
  if (!meta.description) issues.push({ rule: "meta-description", severity: "info", message: "No description; stores and library catalogs show one.", fix: "Add description: to the manifest frontmatter.", src: manifestSrc });

  const checkImage = (ref: ImageRef, src?: SourceRef) => {
    stats.images++;
    if (ref.decorative) stats.decorative++;
    const alt = ref.alt.trim();
    const base = (ref.target.split("/").pop() ?? "").toLowerCase();
    let ok = true;
    if (!ref.path) {
      ok = false;
      issues.push({ rule: "img-missing", severity: "error", message: `Image not found: ${ref.target}`, fix: "Check the file name in the embed.", src });
    } else if (!book.images.has(ref.path)) {
      ok = false;
      issues.push({ rule: "img-format", severity: "error", message: `${ref.target} is not a PNG or JPEG file, so it cannot be included.`, fix: "Export the image as PNG or JPEG.", src });
    }
    if (!ref.decorative) {
      if (!alt) {
        ok = false;
        issues.push({
          rule: "img-alt",
          severity: "error",
          message: `${ref.target} has no text description.`,
          fix: `Write one in the embed: ![[${ref.target}|A short description of what the image shows]]. If it is purely decorative, use ![[${ref.target}|decorative]].`,
          wcag: "1.1.1",
          src,
        });
      } else if (alt.toLowerCase() === base || alt.toLowerCase() === base.replace(/\.[a-z0-9]+$/, "") || /\.(png|jpe?g|gif|webp|svg)$/i.test(alt)) {
        ok = false;
        issues.push({ rule: "img-alt-filename", severity: "error", message: `The description of ${ref.target} is just its file name.`, fix: "Describe what the image shows.", wcag: "1.1.1", src });
      } else {
        if (alt.length > 250) issues.push({ rule: "img-alt-long", severity: "warning", message: `The description of ${ref.target} is ${alt.length} characters long.`, fix: "Keep alt text short and move detail into a caption or the surrounding text.", wcag: "1.1.1", src });
        if (IMAGE_OF.test(alt)) issues.push({ rule: "img-alt-redundant", severity: "info", message: `The description of ${ref.target} starts with “${alt.split(" ").slice(0, 3).join(" ")}”; screen readers already announce it as an image.`, src });
      }
    }
    images.push({ path: ref.path, target: ref.target, alt, decorative: ref.decorative, ok, src });
  };

  const checkInlines = (inlines: Inline[], src: SourceRef) => {
    let current: string | undefined;
    let text = "";
    const flush = () => {
      if (current === undefined) return;
      stats.links++;
      const t = text.trim();
      if (!t) issues.push({ rule: "link-empty", severity: "error", message: `A link to ${current} has no text.`, wcag: "2.4.4", src });
      else if (VAGUE_LINK.test(t)) issues.push({ rule: "link-vague", severity: "warning", message: `The link text “${t}” does not say where it goes.`, fix: "Use words that describe the destination.", wcag: "2.4.4", src });
      current = undefined;
      text = "";
    };
    for (const i of inlines) {
      const href = i.kind === "text" ? i.style.href : undefined;
      if (href !== current) flush();
      if (href) {
        current = href;
        text += i.kind === "text" ? i.text : "";
      }
    }
    flush();
  };

  const walk = (blocks: Block[], state: { lastLevel: number }) => {
    for (const b of blocks) {
      switch (b.kind) {
        case "paragraph":
          checkInlines(b.inlines, b.src);
          break;
        case "heading": {
          stats.headings++;
          const text = b.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("").trim();
          if (!text) issues.push({ rule: "heading-empty", severity: "error", message: "A heading has no text.", wcag: "1.3.1", src: b.src });
          if (b.level > state.lastLevel + 1) {
            issues.push({ rule: "heading-order", severity: "warning", message: `A level ${b.level} heading follows a level ${state.lastLevel} heading, skipping a level.`, fix: `Use ${"#".repeat(state.lastLevel + 1)} for this heading.`, wcag: "1.3.1", src: b.src });
          }
          state.lastLevel = b.level;
          checkInlines(b.inlines, b.src);
          break;
        }
        case "image":
          checkImage(b.image, b.src);
          break;
        case "table":
          stats.tables++;
          if (!b.header.length || b.header.every((c) => !c.length)) {
            issues.push({ rule: "table-header", severity: "warning", message: "A table has no header row.", fix: "Give the first row column names.", wcag: "1.3.1", src: b.src });
          }
          break;
        case "blockquote":
          walk(b.blocks, state);
          break;
        case "list":
          b.items.forEach((it) => walk(it, state));
          break;
        default:
          break;
      }
    }
  };

  for (const ch of book.chapters) {
    if (ch.type === "part") continue;
    stats.chapters++;
    if (!ch.titleText.trim()) issues.push({ rule: "chapter-title", severity: "error", message: "A chapter has no title.", fix: "Start the note with a # Heading.", wcag: "2.4.2", src: ch.src });
    walk(ch.blocks, { lastLevel: 1 });
    for (const n of ch.notes) {
      stats.notes++;
      walk(n.blocks, { lastLevel: 6 });
    }
  }
  if (meta.cover) checkImage(meta.cover);
  for (const w of book.warnings) {
    if (/footnote/i.test(w.message)) issues.push({ rule: "note-missing", severity: "warning", message: w.message, src: w.src });
  }

  const passed = !issues.some((i) => i.severity === "error");
  const content = images.filter((i) => i.target !== meta.cover?.target && !i.decorative);
  const accessMode = content.length ? ["textual", "visual"] : ["textual"];
  const allDescribed = content.every((i) => i.ok);
  const accessModeSufficient = content.length ? (allDescribed ? ["textual", "textual,visual"] : ["textual,visual"]) : ["textual"];
  const accessibilityFeature = ["structuralNavigation", "tableOfContents", "readingOrder", "displayTransformability", "ARIA"];
  if (content.length && allDescribed) accessibilityFeature.push("alternativeText");
  if (opts.pageList) accessibilityFeature.push("printPageNumbers", "pageNavigation");
  const summary = summarize(passed, content.length, allDescribed, opts.pageList, stats.notes > 0);
  return { issues, images, stats, passed, accessMode, accessModeSufficient, accessibilityFeature, accessibilityHazard: ["none"], summary };
}

function summarize(passed: boolean, images: number, described: boolean, pageList: boolean, notes: boolean): string {
  const parts: string[] = [];
  parts.push(passed ? "This publication meets the requirements of EPUB Accessibility 1.1 and WCAG 2.1 Level AA." : "This publication has known accessibility issues and makes no conformance claim.");
  parts.push("It has a navigable table of contents, structural landmarks and headings in a logical reading order, and text that can be resized and restyled.");
  if (images) parts.push(described ? "Every informative image has a text description." : "Some images lack text descriptions.");
  if (pageList) parts.push("Page numbers from the print edition are included for navigation.");
  if (notes) parts.push("Notes are linked to and from the text.");
  parts.push("There are no known hazards such as flashing content, sound or motion.");
  return parts.join(" ");
}
