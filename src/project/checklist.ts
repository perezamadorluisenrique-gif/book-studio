// The publishing checklist (S3 of the app plan): what is still missing before the book can go to KDP.
// Free for everyone. It is not the Pro preflight: it only looks at the details, the cover, the chapters and
// the problems the preview already found. Plain functions, no screen code.

import { readDetails } from "./details";
import { coverAsset } from "./cover-image";
import type { Project } from "./model";

/** Facts that only the built book knows. */
export interface BuiltFacts {
  /** Errors and warnings in the Problems tab. */
  problems: number;
  /** Pictures with no description (alt text). */
  missingAlt: number;
  pages: number;
  /** Spine width in inches, as Book Studio calculates it. */
  spine: number;
}

export type CheckId = "title" | "author" | "language" | "description" | "cover" | "chapters" | "problems" | "alt" | "keywords" | "isbn";
/** Where the person goes to fix it. */
export type FixPlace = "details" | "problems" | "chapters";

export interface CheckItem {
  id: CheckId;
  /** `todo` blocks "ready"; `tip` is worth doing but KDP does not need it. */
  status: "ok" | "todo" | "tip";
  fix?: FixPlace;
  /** Number to show in the message (empty chapters, problems, pictures). */
  n?: number;
}

export interface Checklist {
  items: CheckItem[];
  ready: boolean;
  facts: BuiltFacts | null;
}

const filled = (s: string): boolean => s.trim().length > 0;

/** Run every rule. `facts` is null while the book is not built yet: then the two rules that need it stay as to-do. */
export function publishChecklist(p: Project, facts: BuiltFacts | null): Checklist {
  const d = readDetails(p);
  const emptyChapters = p.chapters.filter((c) => !filled(c.body)).length;
  const items: CheckItem[] = [
    { id: "title", status: filled(d.title) ? "ok" : "todo", fix: "details" },
    { id: "author", status: filled(d.author) ? "ok" : "todo", fix: "details" },
    { id: "language", status: filled(d.language) ? "ok" : "todo", fix: "details" },
    { id: "description", status: filled(d.description) ? "ok" : "todo", fix: "details" },
    { id: "cover", status: coverAsset(p) ? "ok" : "todo", fix: "details" },
    { id: "chapters", status: p.chapters.length > 0 && emptyChapters === 0 ? "ok" : "todo", fix: "chapters", n: p.chapters.length ? emptyChapters : undefined },
    { id: "problems", status: facts && facts.problems === 0 ? "ok" : "todo", fix: "problems", n: facts?.problems },
    { id: "alt", status: facts && facts.missingAlt === 0 ? "ok" : "todo", fix: "problems", n: facts?.missingAlt },
    { id: "keywords", status: filled(d.keywords) ? "ok" : "tip", fix: "details" },
    { id: "isbn", status: filled(d.isbnPrint) ? "ok" : "tip", fix: "details" },
  ];
  return { items, ready: items.every((i) => i.status !== "todo"), facts };
}
