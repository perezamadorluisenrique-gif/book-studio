// Smart punctuation: straight quotes to curly (per language), dashes and ellipses.
// Works across inline runs so `"*Hello*"` still gets an opening quote.

import type { Inline } from "./model";

interface QuoteSet {
  dOpen: string;
  dClose: string;
  sOpen: string;
  sClose: string;
  /** French puts a narrow no-break space inside guillemets and before ; : ! ? */
  frenchSpacing?: boolean;
}

const NNBSP = " ";

function quotesFor(lang: string): QuoteSet {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  switch (base) {
    case "es":
    case "it":
    case "pt":
      return { dOpen: "«", dClose: "»", sOpen: "“", sClose: "”" };
    case "fr":
      return { dOpen: "«", dClose: "»", sOpen: "“", sClose: "”", frenchSpacing: true };
    case "de":
      return { dOpen: "„", dClose: "“", sOpen: "‚", sClose: "‘" };
    default:
      return { dOpen: "“", dClose: "”", sOpen: "‘", sClose: "’" };
  }
}

const APOSTROPHE_WORDS = /^(tis|twas|twere|em|cause|n|til|round|bout)\b/i;

function isOpeningContext(prev: string): boolean {
  return prev === "" || /[\s([{—–\-/«„‚“‘]/.test(prev);
}

function isLetterOrDigit(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Quotes that are open in the paragraph so far, outermost first: "guil" for « » (or the language's own pair), "inner" for the pair inside it. */
export interface QuoteState {
  stack: ("outer" | "inner")[];
}

const NESTS = new Set(["es", "it", "pt", "fr"]);

/** Convert one string, given the character that precedes it (from an earlier run). */
export function smartenText(text: string, lang: string, prevChar = "", state: QuoteState = { stack: [] }): string {
  const q = quotesFor(lang);
  const nests = NESTS.has(lang.toLowerCase().split(/[-_]/)[0]);
  let s = text
    .replace(/\.\.\./g, "…")
    .replace(/---/g, "—")
    .replace(/--/g, "–");
  let out = "";
  let prev = prevChar;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] ?? "";
    if (nests && (ch === "«" || ch === "»" || ch === "“" || ch === "”")) {
      // Quotes typed by hand still count, so a straight pair inside them is set as the inner pair.
      if (ch === "«") state.stack.push("outer");
      else if (ch === "“" && state.stack.length) state.stack.push("inner");
      else if (ch === "»" || ch === "”") state.stack.pop();
      out += ch;
    } else if (ch === '"') {
      const inner = nests && state.stack.length > 0;
      if (isOpeningContext(prev)) {
        if (nests) state.stack.push(inner ? "inner" : "outer");
        out += inner ? "“" : q.dOpen + (q.frenchSpacing ? NNBSP : "");
      } else {
        const top = nests ? state.stack.pop() : "outer";
        out += top === "inner" ? "”" : (q.frenchSpacing ? NNBSP : "") + q.dClose;
      }
    } else if (ch === "'") {
      if (isLetterOrDigit(prev) && (isLetterOrDigit(next) || next === "" || /[\s.,;:!?)]/.test(next))) {
        // don't, it's, dogs' → apostrophe
        out += "’";
      } else if (isOpeningContext(prev)) {
        const rest = s.slice(i + 1);
        if (/^\d/.test(rest) || APOSTROPHE_WORDS.test(rest)) out += "’";
        else out += nests && state.stack.length ? "‘" : q.sOpen;
      } else {
        out += nests && state.stack.length ? "’" : q.sClose;
      }
    } else if (q.frenchSpacing && /[;:!?]/.test(ch) && prev === " ") {
      out = out.slice(0, -1) + NNBSP + ch;
    } else {
      out += ch;
    }
    prev = out.length ? out[out.length - 1] : prev;
  }
  s = out;
  return s;
}

const NBSP = " ";

const ES_ABBR = "Sr|Sra|Srta|Dr|Dra|D|Dña|Ud|Uds|Vd|Vds|Lic|Ing|Prof|Gral|Cnel";
const EN_ABBR = "Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr";
const REF_ABBR = "pág|págs|pp|p|cap|caps|núm|vol|fig|figs|art|tomo|ch|no|vol";
const UNITS = "km|m|cm|mm|kg|g|mg|l|ml|h|min|MB|GB|kB|TB|°C|°F|%|€|\\$|£|US\\$";
const ROMAN = "[IVXLCDM]+";

/** A no-break space where a break would strand a number, title or unit from its word. */
export function glueText(text: string, lang: string): string {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  let s = text;
  const abbr = base === "es" || base === "ca" || base === "gl" || base === "pt" ? ES_ABBR : base === "en" ? EN_ABBR : "";
  if (abbr) s = s.replace(new RegExp(`(^|[\\s(«“"¿¡])(${abbr})\\. (?=\\p{L})`, "gu"), `$1$2.${NBSP}`);
  s = s.replace(new RegExp(`(^|[\\s(«“"])(${REF_ABBR})\\. (?=\\d)`, "giu"), `$1$2.${NBSP}`);
  s = s.replace(/(^|[\s(«“"])(n\.º|n\.°|nº|N\.º) (?=\d)/g, `$1$2${NBSP}`);
  s = s.replace(new RegExp(`(\\d) (${UNITS})(?![\\p{L}\\p{N}])`, "gu"), `$1${NBSP}$2`);
  if (base === "es") s = s.replace(new RegExp(`\\b(siglos?) (?=${ROMAN}\\b)`, "g"), `$1${NBSP}`);
  return s;
}

/** The dash that opens a line of dialogue sits against the first word: "- Hola", "-- Hola" and "— Hola" become "—Hola". */
function dialogueDash(inlines: Inline[]): Inline[] {
  const first = inlines[0];
  if (!first || first.kind !== "text" || first.style.code) return inlines;
  const m = /^(?:—|--|-)\s*(?=[\p{L}¡¿«"“])/u.exec(first.text);
  if (!m) return inlines;
  return [{ ...first, text: "—" + first.text.slice(m[0].length) }, ...inlines.slice(1)];
}

/** Roman numerals after "siglo" become small capitals. */
function centuries(inl: Inline): Inline[] {
  if (inl.kind !== "text" || inl.style.code || inl.style.smallCaps) return [inl];
  const re = new RegExp(`\\b(siglos?[ ${NBSP}])(${ROMAN})(?:( (?:y|al|a|o) )(${ROMAN}))?\\b`, "g");
  const out: Inline[] = [];
  let at = 0;
  const plain = (t: string) => t && out.push({ ...inl, text: t });
  const caps = (t: string) => out.push({ ...inl, text: t, style: { ...inl.style, smallCaps: true } });
  for (let m = re.exec(inl.text); m; m = re.exec(inl.text)) {
    plain(inl.text.slice(at, m.index) + m[1]);
    caps(m[2].toLowerCase());
    if (m[3]) {
      plain(m[3]);
      caps(m[4].toLowerCase());
    }
    at = m.index + m[0].length;
  }
  if (!out.length) return [inl];
  plain(inl.text.slice(at));
  return out;
}

/** Smarten every text inline in place, carrying context across runs; code is left alone. */
export function smartenInlines(inlines: Inline[], lang: string): Inline[] {
  const base = lang.toLowerCase().split(/[-_]/)[0];
  if (base === "es") inlines = dialogueDash(inlines);
  const state: QuoteState = { stack: [] };
  let prev = "";
  const done = inlines.map((inl) => {
    if (inl.kind === "break") {
      prev = "\n";
      return inl;
    }
    if (inl.kind !== "text") return inl;
    if (inl.style.code || inl.style.href?.startsWith("http") && inl.text === inl.style.href) {
      prev = inl.text.slice(-1);
      return inl;
    }
    const text = glueText(smartenText(inl.text, lang, prev, state), lang);
    prev = text.slice(-1) || prev;
    return { ...inl, text };
  });
  return base === "es" ? done.flatMap(centuries) : done;
}
