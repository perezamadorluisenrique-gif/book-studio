// What a book project is when it lives in the browser: a name, the book's details,
// its settings and its chapters. Plain data only (no screen code), so it is easy to test.
// A project is turned into Markdown notes by to-vault.ts; the book engine reads those.

import type { CoverDesign } from "../engine/cover/design";

/** Where a chapter sits in the book. */
export type SectionKind = "front" | "body" | "back";

export interface ProjectChapter {
  id: string;
  title: string;
  /** The chapter text in Markdown, without the title line. */
  body: string;
  /** Optional kind of section (dedication, about-the-author…), written to the note's `section:` property. */
  kind?: string;
}

/** An ordered group of chapters: front matter, the main chapters or back matter. */
export interface ProjectSection {
  kind: SectionKind;
  chapterIds: string[];
}

/** A picture or other file that belongs to the book (a cover, a figure). */
export interface ProjectAsset {
  name: string;
  mime: string;
  data: Uint8Array;
}

/** Where a person is in the first-book guide: its four steps, or "done" (finished or skipped). */
export type Onboarding = 1 | 2 | 3 | 4 | "done";

export interface Project {
  id: string;
  /** The name shown in the list of books. */
  name: string;
  /** Book details written to the book note's front matter (title, author, language, copyright…). */
  meta: Record<string, string>;
  /** Layout settings written to the same front matter (theme, trim, chapter-start…). */
  settings: Record<string, string>;
  sections: ProjectSection[];
  chapters: ProjectChapter[];
  assets: ProjectAsset[];
  /** Milliseconds since 1970, set by whoever changes the project. */
  updatedAt: number;
  /** The step of the first-book guide this book is at. Absent in books saved before the guide existed: they are "done". */
  onboarding?: Onboarding;
  /** The cover built in the cover editor, as layers. Absent: the cover is typeset from the details (or the cover picture). */
  coverDesign?: CoverDesign;
}

/** The guide step of a project; books without one (older books, copies, imports from a folder) have no guide. */
export function onboardingOf(p: Project): Onboarding {
  const v = p.onboarding;
  return v === 1 || v === 2 || v === 3 || v === 4 ? v : "done";
}

export const SECTION_ORDER: SectionKind[] = ["front", "body", "back"];

export function chapterById(p: Project, id: string): ProjectChapter | undefined {
  return p.chapters.find((c) => c.id === id);
}
