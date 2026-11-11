// The back-of-book index is part of Book Studio Pro. The free edition finds no
// index terms, so no index is set; the Pro overlay replaces this file.

export interface IndexSpec {
  main: string;
  sub?: string;
  match: string[];
  see?: string;
}

export interface IndexEntry {
  main: string;
  pages: string[];
  see?: string;
  subs: { sub: string; pages: string[] }[];
}

export interface IndexResult {
  entries: IndexEntry[];
  missing: string[];
}

export function parseIndexSpecs(_items: string[]): IndexSpec[] {
  return [];
}

export function formatPages(folios: string[]): string {
  return folios.join(", ");
}

export function buildIndex(_specs: IndexSpec[], _pages: { folio: string; text: string }[], _lang: string): IndexResult {
  return { entries: [], missing: [] };
}
