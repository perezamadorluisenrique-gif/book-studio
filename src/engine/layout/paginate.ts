// Vertical material and the page builder. Every box carries a penalty for a
// page break after it: widow/orphan control and keep-with-next are encoded there,
// and discardable spaces vanish at page tops and bottoms.

import { INFINITE_PENALTY } from "../linebreak";
import type { SourceRef } from "../model";
import type { Draw, PageStats, TextPos } from "./types";

export interface VBox {
  type: "box";
  height: number;
  /** Draws relative to the box's top-left corner. */
  draws: Draw[];
  /** Penalty for breaking the page after this box; INFINITE_PENALTY forbids it. */
  breakAfter: number;
  start?: TextPos;
  src?: SourceRef;
  /** Footnotes this box calls, which must land on the same page. */
  notes?: string[];
  /** Quality of the line this box holds, for body paragraphs only. */
  q?: { ratio: number; hyphen: boolean };
  /** Line number inside its paragraph, from 1, and the paragraph's line count. */
  para?: number;
  paraLines?: number;
  /** On the first box of a body paragraph that the page builder may re-set a line longer or shorter. */
  group?: ParaGroup;
}

/** Where footnotes come from when they are set at the foot of the page. */
export interface FootnoteSource {
  /** Height of the rule and gap above the notes on a page. */
  separator: number;
  /** Width of the short rule. */
  ruleWidth: number;
  height(id: string): number;
  draws(id: string): Draw[];
}

export interface VSpace {
  type: "space";
  height: number;
}

export interface VNewPage {
  type: "newpage";
}

export type VItem = VBox | VSpace | VNewPage;

export interface FlowPage {
  draws: Draw[];
  start?: TextPos;
  /** Height of material on the page. */
  used: number;
  overflow: boolean;
  stats: PageStats;
}

/** A body paragraph the page builder may re-set with one line more or less to make a page come out full. */
export interface ParaGroup {
  /** Boxes (lines) the paragraph has now. */
  size: number;
  /** The paragraph set in `size + delta` lines, or null when that can't be done. Cached. */
  alt(delta: -1 | 1): VBox[] | null;
  /** True on the boxes of an already re-set paragraph, which isn't adjusted again. */
  adjusted?: boolean;
}

interface Fill {
  /** First box of the page and the last item it takes. */
  start: number;
  end: number;
  used: number;
  /** The flow ends here, or a forced page break closes the page. */
  final: boolean;
  overflow: boolean;
  hyphenEnd: boolean;
  /** Whole lines of the capacity left empty (0 on a final page, or without a line height). */
  short: number;
}

/** Fills one page from item `i`: the same greedy rule for every caller. `null` when no box is left. */
function fill(items: VItem[], i: number, capacity: number, foot: FootnoteSource | undefined, unit: number | undefined): Fill | null {
  const n = items.length;
  const eps = 0.01;
  while (i < n && items[i].type !== "box") i++;
  if (i >= n) return null;
  let h = 0;
  // Notes called by the boxes taken so far, and the height they need at the foot.
  const called = new Set<string>();
  let footH = 0;
  let lastGood = -1;
  let lastFit = -1;
  let j = i;
  let forced = false;
  for (; j < n; j++) {
    const it = items[j];
    if (it.type === "newpage") {
      forced = true;
      break;
    }
    let more = 0;
    if (foot && it.type === "box" && it.notes) {
      const fresh = [...new Set(it.notes)].filter((id) => !called.has(id));
      more = fresh.reduce((a, id) => a + foot.height(id), 0) + (fresh.length && !called.size ? foot.separator : 0);
      if (h + it.height + footH + more > capacity + eps) break;
      for (const id of fresh) called.add(id);
      footH += more;
    } else if (h + it.height + footH > capacity + eps) break;
    h += it.height;
    if (it.type === "box") {
      lastFit = j;
      if (it.breakAfter < INFINITE_PENALTY) lastGood = j;
    }
  }
  let end: number;
  let overflow = false;
  if (j >= n || forced) end = lastFit >= i ? lastFit : i;
  else if (lastGood >= i) end = lastGood;
  else if (lastFit >= i) end = lastFit;
  else {
    // A single box taller than the page.
    end = i;
    overflow = true;
  }
  const final = j >= n || forced;
  let used = 0;
  for (let k = i; k <= end; k++) used += items[k].type === "newpage" ? 0 : (items[k] as VBox | VSpace).height;
  const last = items[end];
  const hyphenEnd = last.type === "box" && !!last.q?.hyphen;
  let short = 0;
  if (unit && !final) short = Math.max(0, Math.floor((capacity - used - notesHeight(items, i, end, foot) + eps) / unit));
  return { start: i, end, used, final, overflow, hyphenEnd, short };
}

/** Height the footnotes called between items `from` and `to` take at the foot of the page. */
function notesHeight(items: VItem[], from: number, to: number, foot?: FootnoteSource): number {
  if (!foot) return 0;
  const ids = new Set<string>();
  for (let k = from; k <= to; k++) {
    const it = items[k];
    if (it.type === "box" && it.notes) for (const id of it.notes) ids.add(id);
  }
  if (!ids.size) return 0;
  let total = foot.separator;
  for (const id of ids) total += foot.height(id);
  return total;
}

/** Draws the page `f` describes. `capacity` places the footnotes; `statCapacity` is the real one, for the stats. */
function emit(items: VItem[], f: Fill, capacity: number, statCapacity: number, foot: FootnoteSource | undefined, unit: number | undefined): FlowPage {
  const page: FlowPage = { draws: [], used: 0, overflow: f.overflow, stats: emptyStats() };
  let y = 0;
  for (let k = f.start; k <= f.end; k++) {
    const it = items[k];
    if (it.type === "newpage") continue;
    if (it.type === "box") {
      for (const d of it.draws) page.draws.push(offsetDraw(d, 0, y));
      if (!page.start && it.start) page.start = it.start;
    }
    y += it.height;
  }
  page.used = y;
  if (foot) {
    const ids = [...new Set(items.slice(f.start, f.end + 1).flatMap((it) => (it.type === "box" && it.notes ? it.notes : [])))];
    if (ids.length) {
      const total = foot.separator + ids.reduce((a, id) => a + foot.height(id), 0);
      let fy = capacity - total;
      page.draws.push({ kind: "rule", x1: 0, y1: fy + foot.separator * 0.5, x2: foot.ruleWidth, y2: fy + foot.separator * 0.5, width: 0.5 });
      fy += foot.separator;
      for (const id of ids) {
        for (const d of foot.draws(id)) page.draws.push(offsetDraw(d, 0, fy));
        fy += foot.height(id);
      }
    }
  }
  const real = f.final || !unit ? f : { ...f, short: Math.max(0, Math.floor((statCapacity - f.used - notesHeight(items, f.start, f.end, foot) + 0.01) / unit)) };
  page.stats = pageStats(items, f.start, f.end, real.short, f.final, f.hyphenEnd);
  return page;
}

/** What a page costs: lines it falls short of full, and a right-hand page that ends on a hyphen. A final page costs nothing. */
const pageCost = (f: Fill, recto: boolean): number => (f.final ? 0 : f.short * 100 + (f.hyphenEnd && recto ? 10 : 0));

/** The items with the `size` boxes from `at` replaced. */
function splice(items: VItem[], at: number, size: number, boxes: VBox[]): VItem[] {
  return [...items.slice(0, at), ...boxes, ...items.slice(at + size)];
}

/** Index of the first box with a paragraph group at or after `from`, or items.length. */
function nextGroup(items: VItem[], from: number): number {
  for (let k = from; k < items.length; k++) {
    const it = items[k];
    if (it.type === "box" && it.group) return k;
  }
  return items.length;
}

/**
 * One page, with a repair: when it comes out short (or ends on a hyphen at the right), try setting one of
 * its paragraphs, or the one that starts on the next page, with one line more or less. The result may be a
 * new item list with the re-set paragraph in it.
 */
function layPage(items: VItem[], i: number, capacity: number, recto: boolean, foot: FootnoteSource | undefined, unit: number | undefined): { items: VItem[]; f: Fill } | null {
  let f = fill(items, i, capacity, foot, unit);
  if (!f) return null;
  let cost = pageCost(f, recto);
  if (cost === 0 || !unit) return { items, f };
  // Up to three one-line adjustments, each the best of its round, and only while the cost keeps falling.
  for (let round = 0; round < 3 && cost > 0; round++) {
    const limit = nextGroup(items, f.end + 1);
    let best: { items: VItem[]; f: Fill; cost: number } | null = null;
    // From the last paragraph back: those nearest the break are the likeliest to settle it. More lines first, since that fills the page.
    for (let k = Math.min(limit, items.length - 1); k >= f.start; k--) {
      const it = items[k];
      if (it.type !== "box" || !it.group || it.group.adjusted) continue;
      for (const delta of [1, -1] as const) {
        const alt = it.group.alt(delta);
        if (!alt) continue;
        const trial = splice(items, k, it.group.size, alt);
        const tf = fill(trial, f.start, capacity, foot, unit);
        if (!tf) continue;
        const c = pageCost(tf, recto);
        if (c < (best?.cost ?? cost)) best = { items: trial, f: tf, cost: c };
      }
      if (best && best.cost === 0) break;
    }
    if (!best) break;
    items = best.items;
    f = best.f;
    cost = best.cost;
  }
  return { items, f };
}

/** Lines to take off the left and the right page of a facing pair, fewest first. */
const REDUCTIONS: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2], [2, 2]];

interface PageRec {
  page: FlowPage;
  /** Where the page starts in the item list (valid in every later list too: edits only touch what comes after). */
  from: number;
  fill: Fill;
  recto: boolean;
}

export interface PaginateOptions {
  /** Line height of the body text, to count how many lines a page is short. */
  unit?: number;
  /** Balance facing pages and re-set paragraphs a line longer or shorter to fill pages. Needs `unit`. */
  balance?: boolean;
  /** The first page of the flow is a right-hand page (the default when balancing). */
  firstRecto?: boolean;
}

/** `capacity` can depend on the page, for a flow that starts below a heading. */
export function paginate(items: VItem[], capacityOf: number | ((page: number) => number), foot?: FootnoteSource, opts: PaginateOptions = {}): FlowPage[] {
  const cap = (no: number) => (typeof capacityOf === "number" ? capacityOf : capacityOf(no));
  const unit = opts.unit;
  if (!opts.balance || !unit) {
    const pages: FlowPage[] = [];
    let i = 0;
    for (;;) {
      const f = fill(items, i, cap(pages.length), foot, unit);
      if (!f) break;
      pages.push(emit(items, f, cap(pages.length), cap(pages.length), foot, unit));
      i = f.end + 1;
    }
    return pages;
  }
  const firstRecto = opts.firstRecto ?? true;
  const rectoAt = (no: number) => (firstRecto ? no % 2 === 0 : no % 2 === 1);
  const hasMore = (list: VItem[], from: number) => {
    for (let k = from; k < list.length; k++) if (list[k].type === "box") return true;
    return false;
  };

  /** Lays the flow out from item `from` as page `no`, a facing pair at a time. */
  const run = (list: VItem[], from: number, no: number): { items: VItem[]; pages: PageRec[] } => {
    const pages: PageRec[] = [];
    let i = from;
    let items = list;
    while (hasMore(items, i)) {
      const pageNo = no + pages.length;
      if (rectoAt(pageNo)) {
        const c = cap(pageNo);
        const r = layPage(items, i, c, true, foot, unit);
        if (!r) break;
        items = r.items;
        pages.push({ page: emit(items, r.f, c, c, foot, unit), from: r.f.start, fill: r.f, recto: true });
        i = r.f.end + 1;
        continue;
      }
      // A left page and the right page facing it: both end at the same line, even if that leaves a line or two of each empty.
      let best: { cost: number; items: VItem[]; left: Fill; right?: Fill; dl: number; dr: number } | null = null;
      search: for (const [dl, dr] of REDUCTIONS) {
        const l = layPage(items, i, cap(pageNo) - dl * unit, false, foot, unit);
        if (!l) break;
        let r: { items: VItem[]; f: Fill } | null = null;
        const rStart = l.f.end + 1;
        if (hasMore(l.items, rStart)) r = layPage(l.items, rStart, cap(pageNo + 1) - dr * unit, true, foot, unit);
        let cost = (dl + dr) * 10;
        // Short is counted against the reduced capacity; add the reduction back to compare the real heights.
        if (r && !l.f.final && !r.f.final) cost += Math.abs(l.f.short + dl - (r.f.short + dr)) * 100;
        if (r && r.f.hyphenEnd && !r.f.final) cost += 10;
        if (!best || cost < best.cost) best = { cost, items: r ? r.items : l.items, left: l.f, right: r?.f, dl, dr };
        if (cost === 0) break search;
      }
      if (!best) break;
      items = best.items;
      const c = cap(pageNo);
      pages.push({ page: emit(items, best.left, c - best.dl * unit, c, foot, unit), from: best.left.start, fill: best.left, recto: false });
      i = best.left.end + 1;
      if (best.right) {
        const c2 = cap(pageNo + 1);
        pages.push({ page: emit(items, best.right, c2 - best.dr * unit, c2, foot, unit), from: best.right.start, fill: best.right, recto: true });
        i = best.right.end + 1;
      }
    }
    return { items, pages };
  };

  let { items: cur, pages } = run(items, 0, 0);

  // A last page with a line or two on it: try setting a paragraph of the last pages a line longer or shorter.
  const tailCost = (list: PageRec[]) => list.reduce((a, p) => a + pageCost(p.fill, p.recto), 0);
  for (let attempt = 0; attempt < 3 && pages.length >= 2; attempt++) {
    const last = pages[pages.length - 1];
    if (last.fill.used >= 4 * unit) break;
    let fixed: { items: VItem[]; pages: PageRec[]; at: number } | null = null;
    for (let q = pages.length - 2; q >= Math.max(0, pages.length - 3) && !fixed; q--) {
      // Redo from the start of the facing pair the page belongs to.
      const s = pages[q].recto && q > 0 ? q - 1 : q;
      const upto = pages[q + 1].from;
      for (let k = pages[q].from; k < upto && !fixed; k++) {
        const it = cur[k];
        if (it.type !== "box" || !it.group || it.group.adjusted) continue;
        for (const delta of [1, -1] as const) {
          const alt = it.group.alt(delta);
          if (!alt) continue;
          const trial = splice(cur, k, it.group.size, alt);
          const redo = run(trial, pages[s].from, s);
          const newLast = redo.pages[redo.pages.length - 1];
          const longEnough = newLast.fill.used >= 4 * unit;
          const gone = s + redo.pages.length < pages.length && tailCost(redo.pages) <= tailCost(pages.slice(s));
          if (longEnough || gone) {
            fixed = { items: trial, pages: redo.pages, at: s };
            break;
          }
        }
      }
    }
    if (!fixed) break;
    cur = fixed.items;
    pages = [...pages.slice(0, fixed.at), ...fixed.pages];
  }
  return pages.map((p) => p.page);
}

export function emptyStats(): PageStats {
  return { lines: 0, loose: 0, veryLoose: 0, hyphens: 0, ladders: 0, short: 0, hyphenEnd: 0, orphans: 0, widows: 0, adjusted: 0 };
}

function pageStats(items: VItem[], from: number, to: number, short: number, final: boolean, hyphenEnd: boolean): PageStats {
  const st = emptyStats();
  const boxes: VBox[] = [];
  for (let k = from; k <= to; k++) {
    const it = items[k];
    if (it.type === "box") boxes.push(it);
  }
  let run = 0;
  for (const b of boxes) {
    if (b.group?.adjusted) st.adjusted++;
    if (!b.q) {
      run = 0;
      continue;
    }
    st.lines++;
    if (b.q.ratio > 1) st.loose++;
    if (b.q.ratio > 2) st.veryLoose++;
    if (b.q.hyphen) {
      st.hyphens++;
      if (++run === 3) st.ladders++;
    } else run = 0;
  }
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  if (hyphenEnd) st.hyphenEnd = 1;
  if (last?.q && last.para === 1 && (last.paraLines ?? 1) > 1) st.orphans = 1;
  if (first?.q && first.para === first.paraLines && (first.paraLines ?? 1) > 1) st.widows = 1;
  if (!final) st.short = short;
  return st;
}

export function offsetDraw(d: Draw, dx: number, dy: number): Draw {
  if (d.kind === "text") return { ...d, x: d.x + dx, y: d.y + dy };
  if (d.kind === "image") return { ...d, x: d.x + dx, y: d.y + dy, clip: d.clip && { ...d.clip, x: d.clip.x + dx, y: d.clip.y + dy } };
  if (d.kind === "rect") return { ...d, x: d.x + dx, y: d.y + dy };
  return { ...d, x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy };
}

export const NO_BREAK = INFINITE_PENALTY;
