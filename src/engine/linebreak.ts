// Knuth–Plass optimum-fit line breaking ("Breaking Paragraphs into Lines", 1981),
// following the box/glue/penalty model TeX uses.

export type KPItem<T = unknown> =
  | { type: "box"; width: number; data?: T }
  | { type: "glue"; width: number; stretch: number; shrink: number; data?: T }
  | { type: "penalty"; width: number; penalty: number; flagged: boolean; data?: T };

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
  prev: Node | null;
}

export function knuthPlass<T>(items: KPItem<T>[], opts: KPOptions): KPBreak[] | null {
  const linePenalty = opts.linePenalty ?? 10;
  const flaggedDemerits = opts.flaggedDemerits ?? 3000;
  const fitnessDemerits = opts.fitnessDemerits ?? 3000;
  const sum = { width: 0, stretch: 0, shrink: 0 };
  let active: Node[] = [{ position: 0, line: 0, fitness: 1, totalWidth: 0, totalStretch: 0, totalShrink: 0, demerits: 0, ratio: 0, prev: null }];

  const ratioFor = (a: Node, end: number, lineIndex: number): number => {
    let width = sum.width - a.totalWidth;
    const item = items[end];
    if (item.type === "penalty") width += item.width;
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

  const tryBreak = (index: number) => {
    const item = items[index];
    const penalty = item.type === "penalty" ? item.penalty : 0;
    const flagged = item.type === "penalty" && item.flagged;
    const next: Node[] = [];
    let i = 0;
    while (i < active.length) {
      // Process active nodes in groups that share a line number (line widths may differ per line).
      const candidates: ({ node: Node; demerits: number; ratio: number } | null)[] = [null, null, null, null];
      let groupLine = -1;
      while (i < active.length) {
        const a = active[i];
        if (groupLine >= 0 && a.line !== groupLine) break;
        groupLine = a.line;
        const ratio = ratioFor(a, index, a.line);
        const deactivate = ratio < -1 || penalty === -INFINITE_PENALTY;
        if (!deactivate) next.push(a);
        if (ratio >= -1 && ratio <= opts.tolerance) {
          const badness = 100 * Math.abs(ratio) ** 3;
          let d: number;
          if (penalty >= 0) d = (linePenalty + badness) ** 2 + penalty ** 2;
          else if (penalty > -INFINITE_PENALTY) d = (linePenalty + badness) ** 2 - penalty ** 2;
          else d = (linePenalty + badness) ** 2;
          const prevItem = items[a.position];
          if (flagged && prevItem.type === "penalty" && prevItem.flagged) d += flaggedDemerits;
          const fitness = ratio < -0.5 ? 0 : ratio <= 0.5 ? 1 : ratio <= 1 ? 2 : 3;
          if (Math.abs(fitness - a.fitness) > 1) d += fitnessDemerits;
          d += a.demerits;
          const c = candidates[fitness];
          if (!c || d < c.demerits) candidates[fitness] = { node: a, demerits: d, ratio };
        }
        i++;
      }
      const after = sumAfter(index);
      for (let f = 0; f < 4; f++) {
        const c = candidates[f];
        if (!c) continue;
        next.push({
          position: index,
          line: c.node.line + 1,
          fitness: f,
          totalWidth: after.width,
          totalStretch: after.stretch,
          totalShrink: after.shrink,
          demerits: c.demerits,
          ratio: c.ratio,
          prev: c.node,
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
  for (const a of active) if (a.position === items.length - 1 && (!best || a.demerits < best.demerits)) best = a;
  if (!best) return null;
  const breaks: KPBreak[] = [];
  for (let n: Node | null = best; n && n.prev; n = n.prev) breaks.push({ position: n.position, ratio: n.ratio });
  return breaks.reverse();
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
