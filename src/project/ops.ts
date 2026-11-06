// The changes you can make to a project (create, rename, add or remove a chapter…).
// Each one returns a new project and leaves the old one untouched. The id and the time
// are passed in, so these functions always give the same result for the same input.

import type { Project, ProjectChapter, ProjectSection, SectionKind } from "./model";
import { starterBook } from "./starter";

export interface NewProject {
  id: string;
  name: string;
  now: number;
  /** Start from the Starter Book template instead of an empty book. */
  template?: boolean;
  language?: string;
  /** The title of the single chapter of an empty book. */
  firstChapterTitle?: string;
}

export function createProject(o: NewProject): Project {
  const name = o.name.trim() || "Untitled";
  if (o.template) {
    const s = starterBook();
    return { id: o.id, name, ...s, meta: { ...s.meta, title: name }, updatedAt: o.now };
  }
  const first: ProjectChapter = { id: "c1", title: o.firstChapterTitle ?? "Chapter One", body: "" };
  return {
    id: o.id,
    name,
    meta: { title: name, author: "", language: o.language ?? "en" },
    settings: { theme: "classic", trim: "6x9" },
    sections: [{ kind: "body", chapterIds: [first.id] }],
    chapters: [first],
    assets: [],
    updatedAt: o.now,
  };
}

const touch = (p: Project, now: number): Project => ({ ...p, updatedAt: now });

/** Renaming also sets the book's title, so the list and the book agree. */
export function renameProject(p: Project, name: string, now: number): Project {
  const next = name.trim();
  if (!next) return p;
  return touch({ ...p, name: next, meta: { ...p.meta, title: next } }, now);
}

export function setMeta(p: Project, key: string, value: string, now: number): Project {
  return touch({ ...p, meta: { ...p.meta, [key]: value } }, now);
}

function nextChapterId(p: Project): string {
  let n = p.chapters.length + 1;
  while (p.chapters.some((c) => c.id === `c${n}`)) n++;
  return `c${n}`;
}

/** Add an empty chapter at the end of a section (the section is created if the book has none like it). */
export function addChapter(p: Project, kind: SectionKind, title: string, now: number): Project {
  const chapter: ProjectChapter = { id: nextChapterId(p), title: title.trim() || "Untitled", body: "" };
  const has = p.sections.some((s) => s.kind === kind);
  const sections: ProjectSection[] = has
    ? p.sections.map((s) => (s.kind === kind ? { ...s, chapterIds: [...s.chapterIds, chapter.id] } : s))
    : [...p.sections, { kind, chapterIds: [chapter.id] }].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return touch({ ...p, chapters: [...p.chapters, chapter], sections }, now);
}

const ORDER: SectionKind[] = ["front", "body", "back"];

export function renameChapter(p: Project, id: string, title: string, now: number): Project {
  const next = title.trim();
  if (!next) return p;
  return touch({ ...p, chapters: p.chapters.map((c) => (c.id === id ? { ...c, title: next } : c)) }, now);
}

export function setChapterBody(p: Project, id: string, body: string, now: number): Project {
  return touch({ ...p, chapters: p.chapters.map((c) => (c.id === id ? { ...c, body } : c)) }, now);
}

export function removeChapter(p: Project, id: string, now: number): Project {
  return touch(
    {
      ...p,
      chapters: p.chapters.filter((c) => c.id !== id),
      sections: p.sections.map((s) => ({ ...s, chapterIds: s.chapterIds.filter((c) => c !== id) })).filter((s) => s.chapterIds.length),
    },
    now,
  );
}
