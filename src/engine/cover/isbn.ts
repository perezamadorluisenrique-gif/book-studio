// ISBN-13 and EAN-13: check digits and the bar pattern for the cover barcode.

/** Digits only, or null if `isbn` isn't 10 or 13 digits (a trailing X is the ISBN-10 check digit). */
export function isbnDigits(isbn: string): string | null {
  const s = isbn.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s)) return s;
  if (/^\d{9}[\dX]$/.test(s)) return s;
  return null;
}

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isbn10Valid(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] === "X" ? 10 : Number(d[i])) * (10 - i);
  return sum % 11 === 0;
}

export type IsbnCheck = { ok: true; isbn13: string } | { ok: false; reason: "format" | "checksum" | "prefix" };

/** Validate an ISBN-13, or an ISBN-10 which is converted to its ISBN-13. */
export function checkIsbn(isbn: string): IsbnCheck {
  const d = isbnDigits(isbn);
  if (!d) return { ok: false, reason: "format" };
  if (d.length === 10) {
    if (!isbn10Valid(d)) return { ok: false, reason: "checksum" };
    const body = `978${d.slice(0, 9)}`;
    return { ok: true, isbn13: body + ean13CheckDigit(body) };
  }
  if (ean13CheckDigit(d.slice(0, 12)) !== Number(d[12])) return { ok: false, reason: "checksum" };
  if (!/^97[89]/.test(d)) return { ok: false, reason: "prefix" };
  return { ok: true, isbn13: d };
}

/**
 * The ISBN for printing: as the author wrote it when it has their hyphens (group
 * lengths depend on the registry, so they can't be worked out from the digits),
 * otherwise the 13 digits.
 */
export function displayIsbn(raw: string, isbn13: string): string {
  const written = raw.trim().replace(/\s+/g, " ");
  return written.replace(/[\s-]/g, "") === isbn13 && /-/.test(written) ? written : isbn13;
}

// Left-hand digits use parity pattern A (odd) or B (even) chosen by the first digit; right-hand use C.
const A = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const PARITY = ["AAAAAA", "AABABB", "AABBAB", "AABBBA", "ABAABB", "ABBAAB", "ABBBAA", "ABABAB", "ABABBA", "ABBABA"];
// C (right-hand digits) is A with the bits inverted; B (the even-parity "G" code) is C read backwards.
const C_PATTERNS = A.map((p) => [...p].map((c) => (c === "0" ? "1" : "0")).join(""));
const B_PATTERNS = C_PATTERNS.map((p) => [...p].reverse().join(""));

/**
 * The 95 modules of an EAN-13 symbol as a string of "1" (bar) and "0" (space):
 * start guard, six left digits, centre guard, six right digits, end guard.
 */
export function ean13Modules(digits: string): string {
  if (!/^\d{13}$/.test(digits) || ean13CheckDigit(digits.slice(0, 12)) !== Number(digits[12])) throw new Error("Not a valid EAN-13 number.");
  const parity = PARITY[Number(digits[0])];
  let out = "101";
  for (let i = 0; i < 6; i++) out += (parity[i] === "A" ? A : B_PATTERNS)[Number(digits[1 + i])];
  out += "01010";
  for (let i = 0; i < 6; i++) out += C_PATTERNS[Number(digits[7 + i])];
  return out + "101";
}
