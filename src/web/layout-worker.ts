// The page layout, run away from the page. The web app sends the loaded book here and gets the Layout back,
// so a long book doesn't freeze typing and scrolling while it is set. The worker keeps its own LayoutCache, so
// a rebuild after an edit only sets the chapter that changed. It loads the fonts and the hyphenation patterns itself.

import { FontSet, type FontFile } from "../engine/fonts";
import { loadHyphenator } from "../engine/hyphenate";
import { layoutBook, LayoutCache, type Layout } from "../engine/layout/index";
import type { Book } from "../engine/model";

export interface LayoutRequest {
  id: number;
  book: Book;
}

export type LayoutReply = { id: number; layout: Layout } | { id: number; error: string };

// The worker's own global scope; the project's types only describe the page.
const scope = self as unknown as { onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null; postMessage(reply: LayoutReply): void; location: { href: string } };

let fonts: Promise<FontSet> | null = null;
const cache = new LayoutCache();

const loadFont = async (f: FontFile): Promise<Uint8Array> => {
  const res = await fetch(new URL(`fonts/${f}.ttf`, scope.location.href));
  if (!res.ok) throw new Error(`Could not load the font ${f}`);
  return new Uint8Array(await res.arrayBuffer());
};

async function run({ id, book }: LayoutRequest): Promise<void> {
  try {
    fonts ??= FontSet.load(loadFont);
    const set = await fonts;
    const hyphenator = book.settings.hyphenate ? await loadHyphenator(book.meta.language) : null;
    scope.postMessage({ id, layout: layoutBook(book, set, { hyphenator, cache }) });
  } catch (err) {
    fonts = null;
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
}

scope.onmessage = (e) => void run(e.data);
