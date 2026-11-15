// Several editions of one book are part of Book Studio Pro. The free edition
// plans none; the Pro overlay replaces this file.

import type { Book, BookSettings } from "./model";
import type { PreflightBinding } from "./preflight";

export interface Edition {
  id: string;
  format: "print" | "epub";
  settings: BookSettings;
  isbn?: string;
  edition?: string;
}

export interface EditionPlan {
  editions: Edition[];
  problems: string[];
}

export function planEditions(_book: Pick<Book, "meta" | "settings">): EditionPlan {
  return { editions: [], problems: [] };
}

/** How an edition prints when it is not a paperback (its page range and cover sheet), or null. */
export function editionBinding(_edition: Edition, _pages: number): PreflightBinding | null {
  return null;
}
