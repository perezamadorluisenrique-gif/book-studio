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

/** Convert one string, given the character that precedes it (from an earlier run). */
export function smartenText(text: string, lang: string, prevChar = ""): string {
  const q = quotesFor(lang);
  let s = text
    .replace(/\.\.\./g, "…")
    .replace(/---/g, "—")
    .replace(/--/g, "–");
  let out = "";
  let prev = prevChar;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] ?? "";
    if (ch === '"') {
      if (isOpeningContext(prev)) {
        out += q.dOpen + (q.frenchSpacing ? NNBSP : "");
      } else {
        out += (q.frenchSpacing ? NNBSP : "") + q.dClose;
      }
    } else if (ch === "'") {
      if (isLetterOrDigit(prev) && (isLetterOrDigit(next) || next === "" || /[\s.,;:!?)]/.test(next))) {
        // don't, it's, dogs' → apostrophe
        out += "’";
      } else if (isOpeningContext(prev)) {
        const rest = s.slice(i + 1);
        if (/^\d/.test(rest) || APOSTROPHE_WORDS.test(rest)) out += "’";
        else out += q.sOpen;
      } else {
        out += q.sClose;
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

/** Smarten every text inline in place, carrying context across runs; code is left alone. */
export function smartenInlines(inlines: Inline[], lang: string): Inline[] {
  let prev = "";
  return inlines.map((inl) => {
    if (inl.kind === "break") {
      prev = "\n";
      return inl;
    }
    if (inl.kind !== "text") return inl;
    if (inl.style.code || inl.style.href?.startsWith("http") && inl.text === inl.style.href) {
      prev = inl.text.slice(-1);
      return inl;
    }
    const text = smartenText(inl.text, lang, prev);
    prev = text.slice(-1) || prev;
    return { ...inl, text };
  });
}
