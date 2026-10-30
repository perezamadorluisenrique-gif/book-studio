// Several editions of one book from one manifest:
//
//   editions:
//     paperback:   { trim: 5x8, isbn: 978-1-23456-789-7 }
//     large-print: { theme: large-print, trim: 7x10, isbn: 978-1-23456-790-3, edition: Large Print Edition }
//     ebook:       { format: epub, isbn: 978-1-23456-791-0 }
//
// Each edition starts from the book's own settings and changes what it lists.

import { checkIsbn } from "./cover/isbn";
import { fmString, settingsFromFrontmatter } from "./manifest";
import type { Book, BookSettings } from "./model";

export interface Edition {
  id: string;
  /** A print PDF with its cover and preflight, or an EPUB. */
  format: "print" | "epub";
  settings: BookSettings;
  isbn?: string;
  /** The edition line on the copyright page. */
  edition?: string;
}

export interface EditionPlan {
  editions: Edition[];
  problems: string[];
}

export function planEditions(book: Pick<Book, "meta" | "settings">): EditionPlan {
  const editions: Edition[] = [];
  const problems: string[] = [];
  for (const [id, fm] of Object.entries(book.meta.editions)) {
    const format = fmString(fm, "format")?.toLowerCase() === "epub" ? "epub" : "print";
    editions.push({
      id,
      format,
      settings: settingsFromFrontmatter(fm, book.settings),
      isbn: fmString(fm, "isbn", "isbn-print", "isbn-ebook"),
      edition: fmString(fm, "edition"),
    });
  }
  const seen = new Map<string, string>();
  for (const e of editions) {
    if (!e.isbn) {
      problems.push(`The ${e.id} edition has no ISBN of its own; KDP needs a different ISBN for each edition.`);
      continue;
    }
    const check = checkIsbn(e.isbn);
    if (!check.ok) {
      problems.push(`The ${e.id} edition's ISBN ${e.isbn} isn't valid.`);
      continue;
    }
    const other = seen.get(check.isbn13);
    if (other) problems.push(`The ${other} and ${e.id} editions use the same ISBN; each edition needs its own.`);
    else seen.set(check.isbn13, e.id);
  }
  return { editions, problems };
}
