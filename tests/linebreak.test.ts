import { describe, expect, it } from "vitest";
import { breakParagraph, FIL, INFINITE_PENALTY, knuthPlass, type KPItem } from "../src/engine/linebreak";

const box = (width: number): KPItem => ({ type: "box", width });
const glue = (stretch = 0.5): KPItem => ({ type: "glue", width: 1, stretch, shrink: 0.33 });
const hyphen = (): KPItem => ({ type: "penalty", width: 1, penalty: 50, flagged: true });
const end = (): KPItem[] => [
  { type: "penalty", width: 0, penalty: INFINITE_PENALTY, flagged: false },
  { type: "glue", width: 0, stretch: FIL, shrink: 0 },
  { type: "penalty", width: 0, penalty: -INFINITE_PENALTY, flagged: false },
];

/** Words made of boxes with optional hyphenation points: `[3, 3]` is a word of two parts of width 3. */
function paragraph(words: number[][], stretch = 0.5): KPItem[] {
  const items: KPItem[] = [];
  words.forEach((parts, w) => {
    parts.forEach((width, p) => {
      items.push(box(width));
      if (p < parts.length - 1) items.push(hyphen());
    });
    if (w < words.length - 1) items.push(glue(stretch));
  });
  return [...items, ...end()];
}

const flaggedAt = (items: KPItem[], breaks: { position: number }[]) => breaks.map((b) => items[b.position].type === "penalty" && (items[b.position] as { flagged: boolean }).flagged);

function longestRun(flags: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const f of flags) {
    run = f ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

describe("line breaking", () => {
  it("keeps the old result when no new option is given", () => {
    const items: KPItem[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let w = 0; w < 40; w++) {
      const parts = 1 + Math.floor(rnd() * 3);
      for (let p = 0; p < parts; p++) {
        items.push(box(2 + Math.floor(rnd() * 4)));
        if (p < parts - 1) items.push(hyphen());
      }
      items.push(glue());
    }
    items.pop();
    items.push(...end());
    const breaks = knuthPlass(items, { lineWidth: () => 30, tolerance: 2 });
    // Positions the previous implementation chose for this exact input.
    expect(breaks?.map((b) => b.position)).toEqual([13, 25, 37, 51, 65, 79, 93, 109, 125, 143, 155]);
    expect(breakParagraph(items, { lineWidth: () => 30, tolerance: 2 })?.breaks).toEqual(breaks);
  });

  it("refuses a forced ladder of three hyphens when maxHyphenRun is 2", () => {
    // One word of seven 4-wide parts in a 9-wide measure: every line but the last has to end on a hyphen.
    const items = paragraph([[4, 4, 4, 4, 4, 4, 4]]);
    const free = breakParagraph(items, { lineWidth: () => 9, tolerance: 4 });
    expect(free).not.toBeNull();
    expect(longestRun(flaggedAt(items, free!.breaks))).toBe(3);
    expect(breakParagraph(items, { lineWidth: () => 9, tolerance: 4, maxHyphenRun: 2 })).toBeNull();
    expect(breakParagraph(items, { lineWidth: () => 9, tolerance: 4, maxHyphenRun: 3 })).not.toBeNull();
  });

  it("never returns more than two hyphens in a row, on 300 random paragraphs", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let solved = 0;
    for (let t = 0; t < 300; t++) {
      const words = Array.from({ length: 16 }, () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => 2 + Math.floor(rnd() * 2)));
      const items = paragraph(words, 4);
      const r = breakParagraph(items, { lineWidth: () => 11, tolerance: 3, flaggedDemerits: 0, maxHyphenRun: 2 });
      if (!r) continue;
      solved++;
      expect(longestRun(flaggedAt(items, r.breaks))).toBeLessThanOrEqual(2);
    }
    expect(solved).toBeGreaterThan(50);
  });

  it("gives exactly the asked number of lines, or null when it can't", () => {
    const items = paragraph(Array.from({ length: 12 }, () => [4]));
    const opts = { lineWidth: () => 20, tolerance: 2 };
    const natural = breakParagraph(items, opts)!.breaks.length;
    expect(natural).toBe(3);
    const more = breakParagraph(items, { ...opts, tolerance: 8, lineCount: natural + 1 });
    expect(more?.breaks.length).toBe(natural + 1);
    expect(breakParagraph(items, { ...opts, lineCount: natural })?.breaks.length).toBe(natural);
    // Twelve 4-wide words can't be squeezed into one line, or spread over twelve.
    expect(breakParagraph(items, { ...opts, tolerance: 8, lineCount: 1 })).toBeNull();
    expect(breakParagraph(items, { ...opts, tolerance: 8, lineCount: 12 })).toBeNull();
  });

  it("moves a word down to avoid a last line that is a single short word", () => {
    // Ten 4-wide words and one 1-wide one at the end: the last line would hold just the small word.
    const items = paragraph([...Array.from({ length: 10 }, () => [4]), [1]]);
    const opts = { lineWidth: () => 25, tolerance: 3 };
    const lastWidth = (br: { position: number }[]) => {
      const start = br[br.length - 2].position + 1;
      let w = 0;
      for (let i = start; i < items.length; i++) if (items[i].type === "box") w += items[i].width;
      return w;
    };
    const plain = breakParagraph(items, opts)!;
    expect(lastWidth(plain.breaks)).toBeLessThan(6);
    const guarded = breakParagraph(items, { ...opts, lastLineMin: 6, runtDemerits: 100000 })!;
    expect(lastWidth(guarded.breaks)).toBeGreaterThanOrEqual(6);
    expect(guarded.breaks.map((b) => b.position)).not.toEqual(plain.breaks.map((b) => b.position));
  });

  it("charges finalHyphenDemerits for a hyphen right before the last line", () => {
    const items = paragraph([[5], [4, 4], [4, 3, 3], [3], [5], [3, 3, 3]], 4);
    const opts = { lineWidth: () => 14, tolerance: 3 };
    const a = breakParagraph(items, opts)!;
    const b = breakParagraph(items, { ...opts, finalHyphenDemerits: 1_000_000 })!;
    const beforeLast = (r: typeof a) => flaggedAt(items, r.breaks).slice(-2)[0];
    expect(beforeLast(a)).toBe(true);
    expect(beforeLast(b)).toBe(false);
  });

  it("lets the last character hang into the margin so a line that was too long now fits", () => {
    // 5 + 1 + 5 + 1 + 7 = 19 in a 17-wide measure: too long, so the last word goes to a second line...
    const words = (pr?: number): KPItem[] => [box(5), glue(), box(5), glue(), { type: "box", width: 7, pr }, ...end()];
    const opts = { lineWidth: () => 17, tolerance: 14 };
    expect(breakParagraph(words(), opts)!.breaks).toHaveLength(2);
    // ...unless its last 2 units hang into the margin.
    expect(breakParagraph(words(2), opts)!.breaks).toHaveLength(1);
  });

  it("counts a box's own stretch when it fits the line", () => {
    // 4 words of 5 plus 3 glues = 23 in a 25-wide measure: 2 short, the glue stretches 1.5 in total, so the ratio is 1.33.
    const plain: KPItem[] = [box(5), glue(), box(5), glue(), box(5), glue(), box(5), { type: "penalty", width: 0, penalty: -INFINITE_PENALTY, flagged: false }];
    const stretchy: KPItem[] = plain.map((it) => (it.type === "box" ? { ...it, stretch: 2, shrink: 2 } : it));
    const a = breakParagraph(plain, { lineWidth: () => 25, tolerance: 0.5 });
    const b = breakParagraph(stretchy, { lineWidth: () => 25, tolerance: 0.5 });
    expect(a).toBeNull();
    expect(b).not.toBeNull();
  });
});
