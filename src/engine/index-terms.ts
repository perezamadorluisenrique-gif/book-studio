// The back-of-book index. The author lists terms in the manifest; Book Studio
// finds them on the printed pages and sets the index with page numbers.
//
//   index-terms:
//     - Napoleon = Bonaparte | the Emperor    # also found under these spellings
//     - Napoleon > exile                      # a sub-entry
//     - lighthouse
//     - Pharos -> lighthouse                  # "Pharos, see lighthouse"
//
// Matching ignores case and accents and only finds whole words.

export interface IndexSpec {
  main: string;
  sub?: string;
  /** Spellings to look for; the first is the entry's own text. */
  match: string[];
  /** A "see" reference instead of page numbers. */
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
  /** Terms that appear on no page. */
  missing: string[];
}

export function parseIndexSpecs(items: string[]): IndexSpec[] {
  const out: IndexSpec[] = [];
  for (const raw of items) {
    let line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    let see: string | undefined;
    const seeAt = line.indexOf("->");
    if (seeAt >= 0) {
      see = line.slice(seeAt + 2).trim() || undefined;
      line = line.slice(0, seeAt).trim();
    }
    let aliases: string[] = [];
    const eq = line.indexOf("=");
    if (eq >= 0) {
      aliases = line.slice(eq + 1).split("|").map((a) => a.trim()).filter(Boolean);
      line = line.slice(0, eq).trim();
    }
    const [main, sub] = line.split(">").map((x) => x.trim());
    if (!main) continue;
    // A sub-entry is found where its own words are; the main term alone does not count it.
    const own = sub ?? main;
    out.push({ main, sub: sub || undefined, match: [own, ...aliases], see });
  }
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcher(spellings: string[]): RegExp {
  const alts = spellings.map(norm).filter(Boolean).sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join("|")})(?![\\p{L}\\p{N}])`, "u");
}

/** "3, 5–7, 12": runs of consecutive page numbers become ranges. */
export function formatPages(folios: string[]): string {
  const nums = [...new Set(folios.map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * Find the specs on the pages. A page's text is searched as written and with
 * line-end hyphenation closed up, so a term split across two lines still counts.
 */
export function buildIndex(specs: IndexSpec[], pages: { folio: string; text: string }[], lang: string): IndexResult {
  const texts = pages.map((p) => {
    const flat = norm(p.text);
    return { folio: p.folio, flat, joined: flat.replace(/-\s+(?=\p{L})/gu, "") };
  });
  const found = new Map<string, Set<string>>();
  const missing: string[] = [];
  const key = (s: IndexSpec) => `${s.main}\u0000${s.sub ?? ""}`;
  for (const spec of specs) {
    if (spec.see) continue;
    const re = matcher(spec.match);
    const set = found.get(key(spec)) ?? new Set<string>();
    for (const t of texts) if (re.test(t.flat) || re.test(t.joined)) set.add(t.folio);
    found.set(key(spec), set);
    if (!set.size) missing.push(spec.sub ? `${spec.main} > ${spec.sub}` : spec.main);
  }
  const collator = new Intl.Collator(lang, { sensitivity: "base", ignorePunctuation: true, numeric: true });
  const mains = new Map<string, IndexEntry>();
  const entryOf = (main: string) => {
    let e = mains.get(norm(main));
    if (!e) {
      e = { main, pages: [], subs: [] };
      mains.set(norm(main), e);
    }
    return e;
  };
  for (const spec of specs) {
    const pagesFound = [...(found.get(key(spec)) ?? [])];
    if (spec.see) {
      entryOf(spec.main).see = spec.see;
      continue;
    }
    if (!pagesFound.length) continue;
    const e = entryOf(spec.main);
    if (spec.sub) {
      const sub = e.subs.find((s) => norm(s.sub) === norm(spec.sub!));
      if (sub) sub.pages.push(...pagesFound);
      else e.subs.push({ sub: spec.sub, pages: pagesFound });
    } else e.pages.push(...pagesFound);
  }
  const entries = [...mains.values()].filter((e) => e.pages.length || e.subs.length || e.see);
  for (const e of entries) {
    e.pages = [...new Set(e.pages)].sort((a, b) => Number(a) - Number(b));
    for (const s of e.subs) s.pages = [...new Set(s.pages)].sort((a, b) => Number(a) - Number(b));
    e.subs.sort((a, b) => collator.compare(a.sub, b.sub));
  }
  entries.sort((a, b) => collator.compare(a.main, b.main));
  return { entries, missing };
}
