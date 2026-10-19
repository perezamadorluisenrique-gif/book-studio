// Liang/TeX hyphenation patterns (via the `hyphen` package) for the book languages
// we ship, with TeX's left/right minimums so we never break "a-way" or "end-ed".

import { hyphenateSync as en } from "hyphen/en-us";
import { hyphenateSync as enGb } from "hyphen/en-gb";
import { hyphenateSync as es } from "hyphen/es";
import { hyphenateSync as fr } from "hyphen/fr";
import { hyphenateSync as de } from "hyphen/de";
import { hyphenateSync as it } from "hyphen/it";
import { hyphenateSync as pt } from "hyphen/pt";

type HyphenFn = (text: string, options?: { hyphenChar?: string; minWordLength?: number }) => string;

const BY_LANG: Record<string, HyphenFn> = { en, "en-gb": enGb, es, fr, de, it, pt };

export const HYPHENATION_LANGUAGES = Object.keys(BY_LANG);

export interface Hyphenator {
  /** Break points inside `word` (indices where a hyphen may be inserted). */
  points(word: string): number[];
}

const LEFT_MIN = 2;
const RIGHT_MIN = 3;

export function hyphenatorFor(lang: string): Hyphenator | null {
  const l = lang.toLowerCase();
  const fn = BY_LANG[l] ?? BY_LANG[l.split(/[-_]/)[0]];
  if (!fn) return null;
  const cache = new Map<string, number[]>();
  return {
    points(word: string): number[] {
      if (word.length < LEFT_MIN + RIGHT_MIN || !/^[\p{L}]+$/u.test(word)) return [];
      // All-caps words are usually acronyms or display text.
      if (word === word.toUpperCase()) return [];
      let pts = cache.get(word);
      if (!pts) {
        const marked = fn(word, { hyphenChar: "­", minWordLength: LEFT_MIN + RIGHT_MIN });
        pts = [];
        let idx = 0;
        for (const ch of marked) {
          if (ch === "­") pts.push(idx);
          else idx += ch.length;
        }
        pts = pts.filter((p) => p >= LEFT_MIN && word.length - p >= RIGHT_MIN);
        cache.set(word, pts);
      }
      return pts;
    },
  };
}
