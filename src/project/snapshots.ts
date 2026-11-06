// Saved versions of a book ("snapshots"). A snapshot is the text, chapters, details and layout choices at one
// moment; pictures are not copied (they stay as they are). Plain data and functions, easy to test.

import type { Project } from "./model";

/** The most versions kept for one book. */
export const MAX_SNAPSHOTS = 20;

/** Why a version was saved: the person asked, an export happened, or a restore / replace was about to change the book. */
export type SnapshotKind = "manual" | "export" | "before-restore" | "before-replace";

export type SnapshotContent = Pick<Project, "name" | "meta" | "settings" | "sections" | "chapters">;

export interface Snapshot {
  id: string;
  projectId: string;
  /** Milliseconds since 1970. */
  at: number;
  kind: SnapshotKind;
  /** A name the person gave it (may be empty). */
  name: string;
  content: SnapshotContent;
}

export function contentOf(p: Project): SnapshotContent {
  return { name: p.name, meta: p.meta, settings: p.settings, sections: p.sections, chapters: p.chapters };
}

/** True when two books have the same text, chapters, details and layout. */
export function sameContent(a: SnapshotContent, b: SnapshotContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function makeSnapshot(p: Project, kind: SnapshotKind, at: number, id: string, name = ""): Snapshot {
  // A deep copy, so later edits of the book can never change a saved version.
  return { id, projectId: p.id, at, kind, name: name.trim(), content: JSON.parse(JSON.stringify(contentOf(p))) as SnapshotContent };
}

/** Which versions to delete so that at most `max` stay: the oldest automatic ones go first, then the oldest of the rest. */
export function toPrune(all: Snapshot[], max = MAX_SNAPSHOTS): string[] {
  const extra = all.length - max;
  if (extra <= 0) return [];
  const oldestFirst = [...all].sort((a, b) => a.at - b.at);
  const auto = oldestFirst.filter((s) => s.kind !== "manual");
  const manual = oldestFirst.filter((s) => s.kind === "manual");
  return [...auto, ...manual].slice(0, extra).map((s) => s.id);
}

/** The book as it was in the snapshot. Pictures stay as they are now; a cover that no longer exists is dropped. */
export function restoreSnapshot(p: Project, s: Snapshot, now: number): Project {
  const back = JSON.parse(JSON.stringify(s.content)) as SnapshotContent;
  const cover = back.meta.cover?.trim();
  if (cover && !p.assets.some((a) => a.name === cover)) delete back.meta.cover;
  return { ...p, ...back, updatedAt: now };
}

/** Words in the whole book (anything separated by spaces), for the list of versions. */
export function wordCount(c: SnapshotContent): number {
  return c.chapters.reduce((n, ch) => n + (ch.body.match(/\S+/g)?.length ?? 0), 0);
}
