// Knuth–Plass optimum-fit line breaking ("Breaking Paragraphs into Lines", 1981),
// following the box/glue/penalty model TeX uses.

export type KPItem<T = unknown> =
  | {
      type: "box";
      width: number;
      data?: T;
      /** The box itself can grow or shrink by this much (letter expansion). */
      stretch?: number;
      shrink?: number;
      /** How far its first / last character may hang into the margin at a line's start / end. */
      pl?: number;
      pr?: number;
    }
  | { type: "glue"; width: number; stretch: number; shrink: number; data?: T }
  | { type: "penalty"; width: number; penalty: number; flagged: boolean; data?: T; /** Hang of the penalty's own width (a hyphen) into the right margin. */ pr?: number };

export const INFINITE_PENALTY = 10000;
export const FIL = 100000;

export interface KPOptions {
  /** Available width for line `index` (0-based). */
  lineWidth: (index: number) => number;
  /** Maximum adjustment ratio a line may stretch to. */
  tolerance: number;
  linePenalty?: number;
  flaggedDemerits?: number;
  fitnessDemerits?: number;
  /** Most lines in a row that may end in a flagged penalty (a hyphen). 0 means no limit. */
  maxHyphenRun?: number;
  /** Added when the last line follows a line that ends in a hyphen. */
  finalHyphenDemerits?: number;
  /** A last line (of a paragraph with more than one) narrower than this gets `runtDemerits`. */
  lastLineMin?: number;
  runtDemerits?: number;
  /** Only solutions with exactly this many lines count. */
  lineCount?: number;
}

export interface KPBreak {
  /** Index of the item the line ends at. */
  position: number;
  /** Adjustment ratio of the line ending here. */
  ratio: number;
}

interface Node {
  position: number;
  line: number;
  fitness: number;
  totalWidth: number;
  totalStretch: number;
  totalShrink: number;
  demerits: number;
  ratio: number;
  /** Lines in a row, ending here, that end in a flagged penalty. */
  run: number;
  prev: Node | null;
}

export function knuthPlass<T>(items: KPItem<T>[], opts: KPOptions): KPBreak[] | null {
  return breakParagraph(items, opts)?.breaks ?? null;
}

/** The best set of breaks and its total demerits; `null` when no breaks stay within the tolerance. */
export function breakParagraph<T>(items: KPItem<T>[], opts: KPOptions): { breaks: KPBreak[]; demerits: number } | null {
  const maxRun = opts.maxHyphenRun ?? 0;
  const finalHyphenDemerits = opts.finalHyphenDemerits ?? 0;
  const lastLineMin = opts.lastLineMin ?? 0;
  const runtDemerits = opts.runtDemerits ?? 0;
  const linePenalty = opts.linePenalty ?? 10;
  const flaggedDemerits = opts.flaggedDemerits ?? 3000;
  const fitnessDemerits = opts.fitnessDemerits ?? 3000;
  const sum = { width: 0, stretch: 0, shrink: 0 };
  // Optical margins: how far the end of a line that breaks at item i, and the start of the line after item i, hang into the margin.
  const { rp, lp, lpFirst } = protrusion(items);
  let active: Node[] = [{ position: 0, line: 0, fitness: 1, totalWidth: 0, totalStretch: 0, totalShrink: 0, demerits: 0, ratio: 0, run: 0, prev: null }];

  const ratioFor = (a: Node, end: number, lineIndex: number): number => {
    let width = sum.width - a.totalWidth;
    const item = items[end];
    if (item.type === "penalty") width += item.width;
    width -= rp[end] + (a.prev ? lp[a.position] : lpFirst);
    const target = opts.lineWidth(lineIndex);
    if (width < target) {
      const stretch = sum.stretch - a.totalStretch;
      return stretch > 0 ? (target - width) / stretch : FIL;
    }
    if (width > target) {
      const shrink = sum.shrink - a.totalShrink;
      return shrink > 0 ? (target - width) / shrink : -FIL;
    }
    return 0;
  };

  const sumAfter = (index: number) => {
    const r = { ...sum };
    for (let i = index; i < items.length; i++) {
      const it = items[i];
      if (it.type === "glue") {
        r.width += it.width;
        r.stretch += it.stretch;
        r.shrink += it.shrink;
      } else if (it.type === "box" || (it.type === "penalty" && it.penalty === -INFINITE_PENALTY && i > index)) break;
    }
    return r;
  };

  const classes = maxRun > 0 ? maxRun + 1 : 1;
  const slots = 4 * classes;
  // The best way into each fitness class and hyphen-run length, reused for every group of every break.
  const candNode: (Node | null)[] = new Array<Node | null>(slots).fill(null);
  const candDemerits = new Float64Array(slots);
  const candRatio = new Float64Array(slots);
  const candRun = new Int32Array(slots);
  const candFitness = new Int32Array(slots);
  const last = items.length - 1;

  const tryBreak = (index: number) => {
    const item = items[index];
    const penalty = item.type === "penalty" ? item.penalty : 0;
    const flagged = item.type === "penalty" && item.flagged;
    const next: Node[] = [];
    let after: { width: number; stretch: number; shrink: number } | null = null;
    let i = 0;
    while (i < active.length) {
      // Process active nodes in groups that share a line number (line widths may differ per line).
      // One candidate per fitness class and hyphen-run length, so a cheap node with a long run can't hide a dearer one that is free to hyphenate.
      candNode.fill(null);
      let groupLine = -1;
      while (i < active.length) {
        const a = active[i];
        if (groupLine >= 0 && a.line !== groupLine) break;
        groupLine = a.line;
        const ratio = ratioFor(a, index, a.line);
        const deactivate = ratio < -1 || penalty === -INFINITE_PENALTY;
        if (!deactivate) next.push(a);
        if (ratio >= -1 && ratio <= opts.tolerance && !(flagged && maxRun > 0 && a.run >= maxRun)) {
          const badness = 100 * Math.abs(ratio) ** 3;
          let d: number;
          if (penalty >= 0) d = (linePenalty + badness) ** 2 + penalty ** 2;
          else if (penalty > -INFINITE_PENALTY) d = (linePenalty + badness) ** 2 - penalty ** 2;
          else d = (linePenalty + badness) ** 2;
          const prevItem = items[a.position];
          if (flagged && prevItem.type === "penalty" && prevItem.flagged) d += flaggedDemerits;
          if (index === last) {
            if (finalHyphenDemerits && prevItem.type === "penalty" && prevItem.flagged) d += finalHyphenDemerits;
            if (runtDemerits && a.line >= 1 && sum.width - a.totalWidth < lastLineMin) d += runtDemerits;
          }
          const fitness = ratio < -0.5 ? 0 : ratio <= 0.5 ? 1 : ratio <= 1 ? 2 : 3;
          if (Math.abs(fitness - a.fitness) > 1) d += fitnessDemerits;
          d += a.demerits;
          const run = flagged ? a.run + 1 : 0;
          const key = fitness + 4 * (maxRun > 0 ? run : 0);
          if (!candNode[key] || d < candDemerits[key]) {
            candNode[key] = a;
            candDemerits[key] = d;
            candRatio[key] = ratio;
            candRun[key] = run;
            candFitness[key] = fitness;
          }
        }
        i++;
      }
      for (let key = 0; key < slots; key++) {
        const from = candNode[key];
        if (!from) continue;
        const line = from.line + 1;
        // With a line count asked for, a line past it, or its last line before the end, can never be part of the answer.
        if (opts.lineCount !== undefined && (line > opts.lineCount || (line === opts.lineCount && index !== last))) continue;
        after ??= sumAfter(index);
        next.push({
          position: index,
          line,
          fitness: candFitness[key],
          totalWidth: after.width,
          totalStretch: after.stretch,
          totalShrink: after.shrink,
          demerits: candDemerits[key],
          ratio: candRatio[key],
          run: candRun[key],
          prev: from,
        });
      }
    }
    // Keep nodes ordered by line so groups stay contiguous.
    next.sort((a, b) => a.line - b.line);
    active = next;
  };

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.type === "box") {
      sum.width += item.width;
      sum.stretch += item.stretch ?? 0;
      sum.shrink += item.shrink ?? 0;
    } else if (item.type === "glue") {
      if (index > 0 && items[index - 1].type === "box") tryBreak(index);
      sum.width += item.width;
      sum.stretch += item.stretch;
      sum.shrink += item.shrink;
    } else if (item.penalty !== INFINITE_PENALTY) {
      tryBreak(index);
    }
    if (!active.length) return null;
  }

  let best: Node | null = null;
  for (const a of active) if (a.position === items.length - 1 && (opts.lineCount === undefined || a.line === opts.lineCount) && (!best || a.demerits < best.demerits)) best = a;
  if (!best) return null;
  const breaks: KPBreak[] = [];
  for (let n: Node | null = best; n && n.prev; n = n.prev) breaks.push({ position: n.position, ratio: n.ratio });
  return { breaks: breaks.reverse(), demerits: best.demerits };
}

/** Hang tables: `rp[i]` for a line breaking at item i, `lp[i]` for a line starting after item i, `lpFirst` for the first line. */
function protrusion<T>(items: KPItem<T>[]): { rp: Float64Array; lp: Float64Array; lpFirst: number } {
  const n = items.length;
  const rp = new Float64Array(n);
  const lp = new Float64Array(n);
  let lastPr = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    if (it.type === "box") lastPr = it.pr ?? 0;
    else rp[i] = it.type === "penalty" && it.width > 0 ? (it.pr ?? 0) : lastPr;
  }
  let nextPl = 0;
  for (let i = n - 1; i >= 0; i--) {
    lp[i] = nextPl;
    const it = items[i];
    if (it.type === "box") nextPl = it.pl ?? 0;
  }
  return { rp, lp, lpFirst: nextPl };
}

/** First-fit breaking: used for ragged text and as the last resort for overfull material. */
export function firstFit<T>(items: KPItem<T>[], lineWidth: (index: number) => number): KPBreak[] {
  const breaks: KPBreak[] = [];
  let width = 0;
  let lastBreak = -1;
  let lastBreakWidth = 0;
  let line = 0;
  let start = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const isBreak = (it.type === "glue" && i > 0 && items[i - 1].type === "box") || (it.type === "penalty" && it.penalty < INFINITE_PENALTY);
    if (isBreak) {
      const w = width + (it.type === "penalty" ? it.width : 0);
      if (w > lineWidth(line) && lastBreak >= start) {
        breaks.push({ position: lastBreak, ratio: 0 });
        line++;
        // Restart measuring after the chosen break, skipping glue at line start.
        width -= lastBreakWidth;
        start = lastBreak + 1;
        i = lastBreak;
        width = 0;
        lastBreak = -1;
        continue;
      }
      if (it.type === "penalty" && it.penalty === -INFINITE_PENALTY) {
        breaks.push({ position: i, ratio: 0 });
        line++;
        width = 0;
        start = i + 1;
        lastBreak = -1;
        continue;
      }
      lastBreak = i;
      lastBreakWidth = width;
    }
    if (it.type === "box") width += it.width;
    else if (it.type === "glue" && i > start && width > 0) width += it.width;
  }
  if (!breaks.length || breaks[breaks.length - 1].position !== items.length - 1) breaks.push({ position: items.length - 1, ratio: 0 });
  return breaks;
}
