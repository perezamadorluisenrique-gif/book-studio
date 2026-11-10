import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { NO_BREAK, paginate, type ParaGroup, type VBox, type VItem } from "../src/engine/layout/paginate";
import { testFonts } from "./helpers/fonts";
import { layoutHyphenated } from "./helpers/layout";
import { memVault } from "./helpers/memVault";

const H = 10;
const CAP = 100;

/** A paragraph of `n` lines of height 10 with the widow and orphan rules of the real line boxes. `alts` lists the line counts it can be re-set to. */
function para(n: number, alts: number[] = []): VBox[] {
  const boxes: VBox[] = [];
  for (let k = 1; k <= n; k++) {
    const breakAfter = k === n ? 0 : k < 2 || n - k < 2 ? NO_BREAK : 0;
    boxes.push({ type: "box", height: H, draws: [], breakAfter, para: k, paraLines: n });
  }
  if (alts.length) {
    const group: ParaGroup = {
      size: n,
      alt: (delta) => {
        const to = n + delta;
        if (!alts.includes(to)) return null;
        const re = para(to);
        re[0].group = { size: to, alt: () => null, adjusted: true };
        return re;
      },
    };
    boxes[0].group = group;
  }
  return boxes;
}

const flow = (...paras: VBox[][]): VItem[] => paras.flat();
const opts = { unit: H, balance: true };

describe("paginate with paragraph repair", () => {
  it("fills a page by setting a paragraph one line longer", () => {
    // P4 can't be split (3 lines), so three paragraphs leave the page a line short, unless P3 gains a line.
    const items = flow(para(3), para(3), para(3, [4]), para(3));
    const plain = paginate(flow(para(3), para(3), para(3), para(3)), CAP, undefined, opts);
    expect(plain[0].used).toBe(90);
    expect(plain[0].stats.short).toBe(1);
    const pages = paginate(items, CAP, undefined, opts);
    expect(pages[0].used).toBe(100);
    expect(pages[0].stats.short).toBe(0);
    expect(pages[0].stats.adjusted).toBe(1);
  });

  it("leaves both pages of a pair with the same number of lines when no paragraph can change", () => {
    // Left page: 3+3+4 = 10 lines. Right page: 3+3+3 = 9, then a 3-line paragraph that doesn't fit.
    const items = flow(para(3), para(3), para(4), para(3), para(3), para(3), para(3));
    const pages = paginate(items, CAP, undefined, { ...opts, firstRecto: false });
    const [left, right] = pages;
    expect(left.stats.short).toBe(right.stats.short);
    // Without balancing they differ, which is what the repair is there to remove.
    const raw = paginate(items, CAP, undefined, { unit: H, firstRecto: false });
    expect(raw[0].stats.short).not.toBe(raw[1].stats.short);
  });

  it("drops a last page of one line by setting an earlier paragraph a line shorter", () => {
    const items = flow(para(4), para(4, [3]), para(2), para(1));
    const raw = paginate(items, CAP, undefined, { unit: H });
    expect(raw).toHaveLength(2);
    expect(raw[1].used).toBe(10);
    const pages = paginate(items, CAP, undefined, opts);
    expect(pages).toHaveLength(1);
    expect(pages[0].stats.adjusted).toBe(1);
  });

  it("keeps the old behaviour when not balancing", () => {
    const items = flow(para(3), para(3), para(3, [4]), para(3), para(5), para(2));
    const pages = paginate(items, CAP);
    // The greedy rule alone: P4 can't be split, so page 1 stops at 9 lines; no paragraph is re-set.
    expect(pages.map((p) => p.used)).toEqual([90, 100]);
    expect(pages.every((p) => p.stats.adjusted === 0)).toBe(true);
  });
});

describe("headings stay with the text", () => {
  const sentence = "En un lugar de la Mancha de cuyo nombre no quiero acordarme no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero adarga antigua rocín flaco y galgo corredor";
  it("never leaves a subheading alone at the foot of a page", async () => {
    const fonts = await testFonts();
    for (let before = 3; before <= 14; before++) {
      const body = Array.from({ length: before }, (_, i) => `${sentence} ${i}. ${sentence}`).join("\n\n");
      const after = Array.from({ length: 12 }, (_, i) => `${sentence} ${i}. ${sentence}`).join("\n\n");
      const vault = memVault({ "Book.md": "---\nbook: true\ntitle: T\nlanguage: es\n---\n- [[One]]\n", "One.md": `# One\n\n${body}\n\n## Zzsubhead\n\n${after}` });
      const layout = await layoutHyphenated(await loadBook(vault, "Book.md"), fonts);
      const bottom = layout.heightPt - layout.margins.bottom + 0.5;
      for (const page of layout.pages) {
        const texts = page.draws.flatMap((d) => (d.kind === "text" && d.y <= bottom ? [d] : []));
        const head = texts.find((d) => d.text.includes("Zzsubhead"));
        if (!head) continue;
        expect(texts.some((d) => d.y > head.y + 1), `subhead is the last line of page ${page.index} with ${before} paragraphs before it`).toBe(true);
      }
    }
  });
});
