// Words the book itself prints: "Chapter One", "Contents", "Notes"…

import type { Chapter } from "./model";

interface BookStrings {
  chapter: string;
  part: string;
  /** A volume in a box set. */
  book: string;
  contents: string;
  notes: string;
  alsoBy: string;
  numberWord: (n: number) => string | null;
}

const EN_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function enWord(n: number): string | null {
  if (n <= 0 || n >= 1000) return null;
  if (n < 20) return EN_ONES[n];
  if (n < 100) return EN_TENS[Math.floor(n / 10)] + (n % 10 ? "-" + EN_ONES[n % 10] : "");
  const rest = n % 100;
  return EN_ONES[Math.floor(n / 100)] + " Hundred" + (rest ? " " + enWord(rest) : "");
}

const ES_ONES = ["", "Uno", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez", "Once", "Doce", "Trece", "Catorce", "Quince", "Dieciséis", "Diecisiete", "Dieciocho", "Diecinueve", "Veinte", "Veintiuno", "Veintidós", "Veintitrés", "Veinticuatro", "Veinticinco", "Veintiséis", "Veintisiete", "Veintiocho", "Veintinueve"];
const ES_TENS = ["", "", "", "Treinta", "Cuarenta", "Cincuenta", "Sesenta", "Setenta", "Ochenta", "Noventa"];

function esWord(n: number): string | null {
  if (n <= 0 || n >= 100) return null;
  if (n < 30) return ES_ONES[n];
  return ES_TENS[Math.floor(n / 10)] + (n % 10 ? " y " + ES_ONES[n % 10].toLowerCase() : "");
}

const STRINGS: Record<string, BookStrings> = {
  en: { chapter: "Chapter", part: "Part", book: "Book", contents: "Contents", notes: "Notes", alsoBy: "Also by", numberWord: enWord },
  es: { chapter: "Capítulo", part: "Parte", book: "Libro", contents: "Índice", notes: "Notas", alsoBy: "Del mismo autor", numberWord: esWord },
  fr: { chapter: "Chapitre", part: "Partie", book: "Livre", contents: "Table des matières", notes: "Notes", alsoBy: "Du même auteur", numberWord: () => null },
  de: { chapter: "Kapitel", part: "Teil", book: "Buch", contents: "Inhalt", notes: "Anmerkungen", alsoBy: "Vom selben Autor", numberWord: () => null },
  it: { chapter: "Capitolo", part: "Parte", book: "Libro", contents: "Indice", notes: "Note", alsoBy: "Dello stesso autore", numberWord: () => null },
  pt: { chapter: "Capítulo", part: "Parte", book: "Livro", contents: "Sumário", notes: "Notas", alsoBy: "Do mesmo autor", numberWord: () => null },
};

export function strings(lang: string): BookStrings {
  return STRINGS[lang.toLowerCase().split(/[-_]/)[0]] ?? STRINGS.en;
}

export function roman(n: number, lower = false): string {
  if (n <= 0) return String(n);
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return lower ? out.toLowerCase() : out;
}

/** "Chapter One", "One", "Chapter 1", "I"… per the theme's label format. */
export function chapterLabel(n: number, lang: string, format: "word" | "numeral" | "roman", prefix: boolean): string {
  const s = strings(lang);
  let num: string;
  if (format === "word") num = s.numberWord(n) ?? String(n);
  else if (format === "roman") num = roman(n);
  else num = String(n);
  return prefix ? `${s.chapter} ${num}` : num;
}

// "Part Two", "Part 2: The Sea", "Book III", but not "Book of Shadows".
const PART_WORD = /^(part|parte|partie|teil|book|libro|livre|buch|livro|volume|vol\.)\s+(\d+|[ivxlc]+\b|\p{L}+(?=\s*[:.–—-]|\s*$))/iu;

/** Strip a written "Part One:" prefix from a manifest part heading; the book prints its own label. */
export function stripPartPrefix(title: string): string {
  return title.replace(/^(part|parte|partie|teil)\s+[^\s:.–—-]+\s*[:.–—-]\s*(?=\S)/i, "");
}

/** The "Part One" (or "Book One" in a box set) label and title of a part, unless the title already names it. */
export function partHeading(part: Pick<Chapter, "titleText" | "partNumber" | "volume">, lang: string): { label: string | null; full: string } {
  const title = part.titleText;
  if (PART_WORD.test(title.trim())) return { label: null, full: title };
  const s = strings(lang);
  const label = `${part.volume ? s.book : s.part} ${chapterLabel(part.partNumber ?? 1, lang, "word", false)}`;
  return { label, full: title ? `${label}: ${title}` : label };
}
