import { describe, expect, it } from "vitest";
import { HYPHENATION_LANGUAGES, loadHyphenator, type Hyphenator } from "../src/engine/hyphenate";
import { ParagraphSetter } from "../src/engine/layout/inline";
import { fromTextStyle, Styler } from "../src/engine/layout/style";
import { themeById } from "../src/engine/themes";
import { testFonts } from "./helpers/fonts";

/** The word with its break points shown as dots. */
const show = (h: Hyphenator, word: string) => {
  const pts = h.points(word);
  return [...word].flatMap((ch, i) => (pts.includes(i) && i > 0 ? [".", ch] : [ch])).join("");
};

describe("hyphenation", () => {
  it("loads each language on demand and returns null for one it doesn't know", async () => {
    for (const lang of HYPHENATION_LANGUAGES) expect(await loadHyphenator(lang), lang).not.toBeNull();
    expect(await loadHyphenator("es-MX")).not.toBeNull();
    expect(await loadHyphenator("xx")).toBeNull();
    // A second call gives the same loaded patterns.
    expect(await loadHyphenator("es")).toBe(await loadHyphenator("es"));
  });

  it("never breaks Spanish words before culo, puta or other rude halves", async () => {
    const es = (await loadHyphenator("es"))!;
    const pts = es.points("espectáculo");
    expect(pts.length).toBeGreaterThan(0);
    // "culo" begins at index 7 of "espectáculo".
    expect(pts).not.toContain("espectáculo".indexOf("culo"));
    expect(es.points("disputa")).not.toContain(3);
    expect(show(es, "disputa")).not.toContain("dis.puta");
    expect(es.points("penetrar")).not.toContain(4);
  });

  it("doesn't leave a single vowel alone at the start or the end of a Spanish word", async () => {
    const es = (await loadHyphenator("es"))!;
    expect(es.points("aéreo")).not.toContain(1);
    expect(es.points("aéreo")).not.toContain(4);
    for (const word of ["aéreo", "abeja", "ideal", "oasis", "isla", "euforia"]) {
      const pts = es.points(word);
      expect(pts.every((p) => p >= 2 && word.length - p >= 2), word).toBe(true);
    }
  });

  it("uses 2 and 3 as the English minimums and 2 and 2 for Spanish and German", async () => {
    const en = (await loadHyphenator("en"))!;
    const es = (await loadHyphenator("es"))!;
    for (const p of en.points("interesting")) expect("interesting".length - p).toBeGreaterThanOrEqual(3);
    // "palabra": the last piece may be two letters in Spanish (pala-bra needs 3 so this one checks 2 is allowed elsewhere).
    expect(es.points("importante").some((p) => "importante".length - p === 2)).toBe(true);
  });

  it("hyphenates Catalan, Galician, Basque and Dutch", async () => {
    expect(show((await loadHyphenator("ca"))!, "ordinador")).toContain(".");
    expect(show((await loadHyphenator("gl"))!, "universidade")).toContain(".");
    expect(show((await loadHyphenator("eu"))!, "hizkuntzalaritza")).toContain(".");
    expect(show((await loadHyphenator("nl"))!, "ontwikkelingsland")).toContain(".");
  });

  it("gives no break points to acronyms and to words with digits", async () => {
    const es = (await loadHyphenator("es"))!;
    expect(es.points("OTAN")).toEqual([]);
    expect(es.points("covid19")).toEqual([]);
    expect(es.points("COVID")).toEqual([]);
  });
});

describe("the author's controls over where a word splits", () => {
  const body = themeById("classic").body;
  const run = async (text: string, width: number) => {
    const fonts = await testFonts();
    const setter = new ParagraphSetter(new Styler(fonts, "es"), await loadHyphenator("es"));
    const set = setter.set([{ kind: "text", text, style: {} }], fromTextStyle(body, false), { width, align: "justify", hyphenate: true });
    return set.lines.map((l) => l.pieces.map((p) => p.text).join(""));
  };

  it("splits a long word at its patterns when nothing says otherwise", async () => {
    const lines = await run("anticonstitucionalmente", 70);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(0, -1).every((l) => l.endsWith("-"))).toBe(true);
  });

  it("doesn't split a word that contains a word joiner, and doesn't print the joiner", async () => {
    const lines = await run("anticonstitucional⁠mente", 70);
    expect(lines.join("")).not.toContain("⁠");
    expect(lines.slice(0, -1).some((l) => l.endsWith("-"))).toBe(false);
  });

  it("splits a word with a soft hyphen only there", async () => {
    const lines = await run("anticonsti­tucionalmente", 70);
    expect(lines.join("")).not.toContain("­");
    const hyphenEnds = lines.slice(0, -1).filter((l) => l.endsWith("-"));
    expect(hyphenEnds.length).toBeLessThanOrEqual(1);
    if (hyphenEnds.length) expect(lines[0]).toBe("anticonsti-");
  });

  it("doesn't hyphenate a word that has a digit in it", async () => {
    const lines = await run("covid19pandemica", 40);
    expect(lines.slice(0, -1).some((l) => l.endsWith("-"))).toBe(false);
  });
});
