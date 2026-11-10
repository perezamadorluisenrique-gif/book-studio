// Lays a book out with its language's hyphenation patterns, as the app does.

import type { FontSet } from "../../src/engine/fonts";
import { loadHyphenator } from "../../src/engine/hyphenate";
import { layoutBook, type Layout } from "../../src/engine/layout/index";
import type { Book } from "../../src/engine/model";

export async function layoutHyphenated(book: Book, fonts: FontSet): Promise<Layout> {
  return layoutBook(book, fonts, { hyphenator: book.settings.hyphenate ? await loadHyphenator(book.meta.language) : null });
}
