// Find and replace across a whole book: the chapter texts and the chapter titles. The text typed is taken
// literally (no patterns), so "a.b" finds "a.b" and "$1" is just "$1".

import type { Project } from "./model";

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export interface FoundChapter {
  id: string;
  title: string;
  count: number;
}

export interface Found {
  total: number;
  chapters: FoundChapter[];
}

const WORD = /[\p{L}\p{N}_]/u;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where each match starts in `text` (not overlapping, left to right). */
function matches(text: string, find: string, o: FindOptions): number[] {
  if (!find) return [];
  const re = new RegExp(escape(find), o.matchCase ? "gu" : "giu");
  const at: number[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (o.wholeWord) {
      const before = text.slice(0, start).match(/[\s\S]$/u)?.[0] ?? "";
      const after = text.slice(start + m[0].length).match(/^[\s\S]/u)?.[0] ?? "";
      if ((before && WORD.test(before)) || (after && WORD.test(after))) continue;
    }
    at.push(start);
  }
  return at;
}

/** How many times `find` appears in each chapter (title and text together). */
export function findAll(p: Project, find: string, o: FindOptions): Found {
  const chapters: FoundChapter[] = [];
  let total = 0;
  for (const c of p.chapters) {
    const count = matches(c.title, find, o).length + matches(c.body, find, o).length;
    if (count) chapters.push({ id: c.id, title: c.title, count });
    total += count;
  }
  return { total, chapters };
}

function replaceIn(text: string, find: string, to: string, o: FindOptions): { text: string; count: number } {
  const at = matches(text, find, o);
  if (!at.length) return { text, count: 0 };
  // The length of a match can differ from `find` for case folding, so measure it where it was found.
  const re = new RegExp(escape(find), o.matchCase ? "gu" : "giu");
  re.lastIndex = 0;
  let out = "";
  let from = 0;
  for (const start of at) {
    re.lastIndex = start;
    const len = re.exec(text)?.[0].length ?? find.length;
    out += text.slice(from, start) + to;
    from = start + len;
  }
  return { text: out + text.slice(from), count: at.length };
}

/** Replace every match; gives the same project (and 0) when nothing matched. A title never becomes empty. */
export function replaceAll(p: Project, find: string, to: string, o: FindOptions, now: number): { project: Project; count: number } {
  let count = 0;
  const chapters = p.chapters.map((c) => {
    const t = replaceIn(c.title, find, to, o);
    const b = replaceIn(c.body, find, to, o);
    count += t.count + b.count;
    if (!t.count && !b.count) return c;
    return { ...c, title: t.text.trim() ? t.text : c.title, body: b.text };
  });
  return count ? { project: { ...p, chapters, updatedAt: now }, count } : { project: p, count: 0 };
}
