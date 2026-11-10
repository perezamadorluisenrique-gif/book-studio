// Liang/TeX hyphenation patterns (via the `hyphen` package) for the book languages we ship. Each language's
// patterns load on demand, so a book only pays for the one it is written in. TeX's left/right minimums keep
// us from breaking "a-way" or "end-ed", and a few language rules remove the breaks that read badly.

type HyphenFn = (text: string, options?: { hyphenChar?: string; minWordLength?: number }) => string;
type Mod = { hyphenateSync?: HyphenFn; default?: { hyphenateSync?: HyphenFn } };
type Loader = () => Promise<Mod>;

const LOADERS: Record<string, Loader> = {
  en: () => import("hyphen/en-us"),
  "en-gb": () => import("hyphen/en-gb"),
  es: () => import("hyphen/es"),
  fr: () => import("hyphen/fr"),
  de: () => import("hyphen/de"),
  it: () => import("hyphen/it"),
  pt: () => import("hyphen/pt"),
  ca: () => import("hyphen/ca"),
  gl: () => import("hyphen/gl"),
  eu: () => import("hyphen/eu"),
  nl: () => import("hyphen/nl"),
};

export const HYPHENATION_LANGUAGES = Object.keys(LOADERS);

export interface Hyphenator {
  /** Break points inside `word` (indices where a hyphen may be inserted). */
  points(word: string): number[];
}

/** Shortest piece left at the start and at the end of a word, per language (TeX's \lefthyphenmin and \righthyphenmin). */
const MINS: Record<string, [number, number]> = {
  es: [2, 2],
  ca: [2, 2],
  gl: [2, 2],
  eu: [2, 2],
  it: [2, 2],
  pt: [2, 2],
  en: [2, 3],
  "en-gb": [2, 3],
  fr: [2, 3],
  de: [2, 2],
  nl: [2, 2],
};

/** Spanish words that must never appear whole as the first or the second half of a split word. */
const ES_TABOO = new Set(["culo", "puta", "puto", "pene", "caca", "pedo", "teta", "ano", "coño", "mea", "caga", "sexo"]);
const VOWELS = /^[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]$/;

function key(lang: string): string | null {
  const l = lang.toLowerCase();
  if (LOADERS[l]) return l;
  const base = l.split(/[-_]/)[0];
  return LOADERS[base] ? base : null;
}

const loaded = new Map<string, Promise<Hyphenator>>();

/** The hyphenator for a language, loading its patterns the first time; `null` when we have none. */
export async function loadHyphenator(lang: string): Promise<Hyphenator | null> {
  const k = key(lang);
  if (!k) return null;
  let hit = loaded.get(k);
  if (!hit) {
    hit = LOADERS[k]().then((m) => build(k, (m.hyphenateSync ?? m.default?.hyphenateSync) as HyphenFn));
    loaded.set(k, hit);
  }
  return hit;
}

function build(lang: string, fn: HyphenFn): Hyphenator {
  const [leftMin, rightMin] = MINS[lang] ?? [2, 3];
  const cache = new Map<string, number[]>();
  return {
    points(word: string): number[] {
      if (word.length < leftMin + rightMin || !/^[\p{L}]+$/u.test(word)) return [];
      // All-caps words are usually acronyms or display text.
      if (word === word.toUpperCase()) return [];
      let pts = cache.get(word);
      if (!pts) {
        const marked = fn(word, { hyphenChar: "­", minWordLength: leftMin + rightMin });
        pts = [];
        let idx = 0;
        for (const ch of marked) {
          if (ch === "­") pts.push(idx);
          else idx += ch.length;
        }
        pts = pts.filter((p) => p >= leftMin && word.length - p >= rightMin);
        if (lang === "es") pts = pts.filter((p) => okInSpanish(word, p));
        cache.set(word, pts);
      }
      return pts;
    },
  };
}

/** No point that leaves a single vowel on one side, or a rude word as one of the two halves. */
function okInSpanish(word: string, at: number): boolean {
  const left = word.slice(0, at);
  const right = word.slice(at);
  if (left.length === 1 && VOWELS.test(left)) return false;
  if (right.length === 1 && VOWELS.test(right)) return false;
  return !ES_TABOO.has(left.toLowerCase()) && !ES_TABOO.has(right.toLowerCase());
}
