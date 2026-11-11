// Several editions of one book are part of Book Studio Pro. The free edition
// plans none; the Pro overlay replaces this file.

import type { Book, BookSettings } from "./model";

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
