// The changes you can make to a project (create, rename, add or remove a chapter…).
// Each one returns a new project and leaves the old one untouched. The id and the time
// are passed in, so these functions always give the same result for the same input.

import { SECTION_ORDER, type Project, type ProjectChapter, type ProjectSection, type SectionKind } from "./model";
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
    : [...p.sections, { kind, chapterIds: [chapter.id] }].sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind));
  return touch({ ...p, chapters: [...p.chapters, chapter], sections }, now);
}

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

// ── Order of the chapters ──

/** Where a chapter is now: its section and its place (from 0) in that section. */
export function locate(p: Project, id: string): { kind: SectionKind; index: number } | null {
  for (const s of p.sections) {
    const index = s.chapterIds.indexOf(id);
    if (index >= 0) return { kind: s.kind, index };
  }
  return null;
}

/** The chapter ids of one section, in order (empty when the book has no such section). */
export function sectionIds(p: Project, kind: SectionKind): string[] {
  return p.sections.filter((s) => s.kind === kind).flatMap((s) => s.chapterIds);
}

/** Every chapter id in the order they appear in the book. */
export function bookOrder(p: Project): string[] {
  return SECTION_ORDER.flatMap((k) => sectionIds(p, k));
}

/**
 * Put a chapter in a section at a place (from 0, counted after the chapter is taken out of
 * where it was; too big a number means the end). Gives back the same project when nothing changes.
 */
export function reorder(p: Project, id: string, kind: SectionKind, index: number, now: number): Project {
  if (!locate(p, id)) return p;
  const lists = new Map<SectionKind, string[]>();
  for (const k of SECTION_ORDER) lists.set(k, sectionIds(p, k).filter((c) => c !== id));
  const target = lists.get(kind) ?? [];
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  const sections: ProjectSection[] = SECTION_ORDER.filter((k) => lists.get(k)?.length).map((k) => ({ kind: k, chapterIds: lists.get(k) ?? [] }));
  const same = sections.length === p.sections.length && sections.every((s, i) => s.kind === p.sections[i].kind && s.chapterIds.join("\n") === p.sections[i].chapterIds.join("\n"));
  return same ? p : touch({ ...p, sections }, now);
}

/** Move a chapter one place up (-1) or down (1). At the end of a section it goes into the next one. */
export function move(p: Project, id: string, delta: -1 | 1, now: number): Project {
  const at = locate(p, id);
  if (!at) return p;
  const size = sectionIds(p, at.kind).length;
  const inside = at.index + delta;
  if (inside >= 0 && inside < size) return reorder(p, id, at.kind, inside, now);
  const other = SECTION_ORDER[SECTION_ORDER.indexOf(at.kind) + delta];
  if (!other) return p;
  return reorder(p, id, other, delta < 0 ? Number.MAX_SAFE_INTEGER : 0, now);
}
