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
  /** Extra height the page builder may add here to bring the last line down to the foot of the page. */
  stretch?: number;
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
  /** Height added to the stretchable spaces of the page, already counted in `used`. */
  grow: number;
}

/** Fills one page from item `i`: the same greedy rule for every caller. `null` when no box is left. */
function fill(items: VItem[], i: number, capacity: number, foot: FootnoteSource | undefined, unit: number | undefined, flex = false): Fill | null {
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
  let grow = 0;
  if (unit && !final) {
    const room = capacity - used - notesHeight(items, i, end, foot);
    if (flex && room > eps) {
      let can = 0;
      for (let k = i; k <= end; k++) {
        const it = items[k];
        if (it.type === "space" && it.stretch) can += it.stretch;
      }
      grow = Math.min(room, can);
      used += grow;
    }
    short = Math.max(0, Math.floor((room - grow + eps) / unit));
  }
  return { start: i, end, used, final, overflow, hyphenEnd, short, grow };
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
function emit(items: VItem[], f: Fill, capacity: number, statCapacity: number, foot: FootnoteSource | undefined, unit: number | undefined, long = 0): FlowPage {
  const page: FlowPage = { draws: [], used: 0, overflow: f.overflow, stats: emptyStats() };
  let y = 0;
  let can = 0;
  if (f.grow > 0) {
    for (let k = f.start; k <= f.end; k++) {
      const it = items[k];
      if (it.type === "space" && it.stretch) can += it.stretch;
    }
  }
  for (let k = f.start; k <= f.end; k++) {
    const it = items[k];
    if (it.type === "newpage") continue;
    if (it.type === "box") {
      for (const d of it.draws) page.draws.push(offsetDraw(d, 0, y));
      if (!page.start && it.start) page.start = it.start;
    }
    y += it.height;
    // Every stretchable space takes its share of what the page needs to reach the foot.
    if (can > 0 && it.type === "space" && it.stretch) y += (f.grow * it.stretch) / can;
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
  if (!f.final) page.stats.long = Math.max(0, long);
  return page;
}

/** The items with the `size` boxes from `at` replaced. */
function splice(items: VItem[], at: number, size: number, boxes: VBox[]): VItem[] {
  return [...items.slice(0, at), ...boxes, ...items.slice(at + size)];
}

// What the page builder pays for each flaw when it balances a chapter. A short page is the flaw to avoid;
// a facing pair that ends at two heights is worse than both pages a line short.
const COST_SHORT = 100;
const COST_LONG = 30;
const COST_UNEVEN = 1000;
const COST_STUB = 150;
const COST_HYPHEN_TURN = 60;
const COST_ALT = 3;
/** Per line of space added above headings and around breaks. */
const COST_STRETCH = 15;
/** A last page with fewer lines than this is a stub. */
const STUB_LINES = 4;
/** Pages the search may open before it settles for the best start found so far. */
const SEARCH_LIMIT = 6000;

/** One way of ending a page: the item list (a paragraph may be re-set in it), where it ends, and how many lines it is off full. */
interface PageOpt {
  items: VItem[];
  f: Fill;
  /** Lines over (+) or under (−) the full page; 0 on a final page. */
  dev: number;
  /** Paragraphs re-set to get here. */
  alts: number;
}

export interface PaginateOptions {
  /** Line height of the body text, to count how many lines a page is short. */
  unit?: number;
  /** Balance facing pages and re-set paragraphs a line longer or shorter to fill pages. Needs `unit`. */
  balance?: boolean;
  /** The first page of the flow is a right-hand page (the default when balancing). */
  firstRecto?: boolean;
  /** Lines a facing pair may run past the foot of the page, both pages alike (0 by default). */
  maxLong?: number;
}

interface PlacedPage {
  items: VItem[];
  f: Fill;
  dev: number;
  cap: number;
}

interface SearchNode {
  items: VItem[];
  /** Where the next page starts. */
  i: number;
  pageNo: number;
  cost: number;
  parent: SearchNode | null;
  /** The pages laid to get here from `parent`. */
  pages: PlacedPage[];
  done: boolean;
  closed?: boolean;
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
  const devs: number[] = [];
  for (let d = Math.max(0, Math.floor(opts.maxLong ?? 0)); d >= -2; d--) devs.push(d);
  const firstBox = (list: VItem[], from: number): number => {
    let k = from;
    while (k < list.length && list[k].type !== "box") k++;
    return k;
  };

  // Lists with one paragraph re-set, so the same edit of the same list is the same list.
  const edits = new WeakMap<VItem[], Map<string, VItem[] | null>>();
  const edited = (list: VItem[], k: number, delta: -1 | 1): VItem[] | null => {
    let m = edits.get(list);
    if (!m) edits.set(list, (m = new Map<string, VItem[] | null>()));
    const key = `${k}:${delta}`;
    if (!m.has(key)) {
      const g = (list[k] as VBox).group!;
      const alt = g.alt(delta);
      m.set(key, alt ? splice(list, k, g.size, alt) : null);
    }
    return m.get(key) ?? null;
  };

  /** Every distinct way page `no` can end when it starts at item `i` of `list`. */
  const pageOptions = (list: VItem[], i: number, no: number): PageOpt[] => {
    const c = cap(no);
    const out: PageOpt[] = [];
    const seen = new Map<VItem[], Set<number>>();
    const tryList = (l: VItem[], alts: number, upto: number): void => {
      for (const d of devs) {
        const f = fill(l, i, c + d * unit, foot, unit, true);
        if (!f || f.end < upto) continue;
        let ends = seen.get(l);
        if (!ends) seen.set(l, (ends = new Set()));
        if (ends.has(f.end)) continue;
        ends.add(f.end);
        out.push({ items: l, f, dev: f.final ? 0 : d - f.short, alts });
        if (f.final) break;
      }
    };
    tryList(list, 0, -1);
    if (!out.length) return out;
    // Paragraphs that start on the page (as the longest way of ending it has it) can be set a line longer or shorter.
    const last = out[0].f.end;
    const singles: { k: number; delta: -1 | 1; list: VItem[] }[] = [];
    for (let k = i; k <= last; k++) {
      const it = list[k];
      if (it.type !== "box" || !it.group || it.group.adjusted) continue;
      for (const delta of [1, -1] as const) {
        const l = edited(list, k, delta);
        if (!l) continue;
        singles.push({ k, delta, list: l });
        // The re-set paragraph must start on the page, or the pages after it would not know about it.
        tryList(l, 1, k);
      }
    }
    // Two at once: one alone may only move the problem.
    if (singles.length <= 8) {
      for (let a = 0; a < singles.length; a++) {
        for (let b = a + 1; b < singles.length; b++) {
          const first = singles[a];
          const second = singles[b];
          if (first.k === second.k) continue;
          // `second` comes later in the list (k grows), so edit it first: the earlier index stays valid.
          const l2 = edited(list, second.k, second.delta);
          const l = l2 && edited(l2, first.k, first.delta);
          if (!l) continue;
          const shift = (list[first.k] as VBox).group!.alt(first.delta)!.length - (list[first.k] as VBox).group!.size;
          tryList(l, 2, second.k + shift);
        }
      }
    }
    return out;
  };

  const pageCost = (o: PageOpt, recto: boolean): number => {
    let c = o.alts * COST_ALT;
    if (o.f.final) return c;
    c += (o.f.grow / unit) * COST_STRETCH;
    c += o.dev < 0 ? -o.dev * COST_SHORT : o.dev * COST_LONG;
    if (o.f.hyphenEnd && recto) c += COST_HYPHEN_TURN;
    return c;
  };
  const stub = (o: PageOpt, no: number): number => (o.f.final && no > 0 && o.f.used < STUB_LINES * unit ? COST_STUB : 0);
  const moreAfter = (o: PageOpt): boolean => firstBox(o.items, o.f.end + 1) < o.items.length;
  const placed = (o: PageOpt, no: number): PlacedPage => ({ items: o.items, f: o.f, dev: o.dev, cap: cap(no) });

  // Cheapest way through the chapter, a facing pair at a time. A search node is "the next pair starts at this box".
  const nodes = new Map<VBox, Map<number, SearchNode>>();
  const heap: SearchNode[] = [];
  const push = (n: SearchNode): void => {
    heap.push(n);
    let k = heap.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (heap[up].cost <= heap[k].cost) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = (): SearchNode | undefined => {
    const top = heap[0];
    const tail = heap.pop();
    if (heap.length && tail) {
      heap[0] = tail;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  let goal: SearchNode | null = null;
  const reach = (from: SearchNode, pages: PlacedPage[], lastOpt: PageOpt, cost: number): void => {
    const total = from.cost + cost;
    const next = firstBox(lastOpt.items, lastOpt.f.end + 1);
    const pageNo = from.pageNo + pages.length;
    if (next >= lastOpt.items.length) {
      if (!goal || total < goal.cost) goal = { items: lastOpt.items, i: next, pageNo, cost: total, parent: from, pages, done: true };
      return;
    }
    const box = lastOpt.items[next] as VBox;
    let byNo = nodes.get(box);
    if (!byNo) nodes.set(box, (byNo = new Map<number, SearchNode>()));
    const known = byNo.get(pageNo);
    if (known && known.cost <= total) return;
    const n: SearchNode = { items: lastOpt.items, i: next, pageNo, cost: total, parent: from, pages, done: false };
    byNo.set(pageNo, n);
    push(n);
  };

  const root: SearchNode = { items, i: firstBox(items, 0), pageNo: 0, cost: 0, parent: null, pages: [], done: false };
  if (root.i >= items.length) return [];
  push(root);
  let opened = 0;
  let deepest = root;
  for (;;) {
    const n = pop();
    if (!n) break;
    if (goal && (goal as SearchNode).cost <= n.cost) break;
    if (n.closed || nodes.get(n.items[n.i] as VBox)?.get(n.pageNo) !== n && n !== root) continue;
    n.closed = true;
    if (n.pageNo > deepest.pageNo || (n.pageNo === deepest.pageNo && n.cost < deepest.cost)) deepest = n;
    if (++opened > SEARCH_LIMIT) break;
    const no = n.pageNo;
    if (rectoAt(no)) {
      // A right-hand page with no left page of this flow facing it.
      for (const o of pageOptions(n.items, n.i, no)) reach(n, [placed(o, no)], o, pageCost(o, true) + stub(o, no));
      continue;
    }
    for (const l of pageOptions(n.items, n.i, no)) {
      const lc = pageCost(l, false) + stub(l, no);
      if (l.f.final || !moreAfter(l)) {
        reach(n, [placed(l, no)], l, lc);
        continue;
      }
      for (const r of pageOptions(l.items, firstBox(l.items, l.f.end + 1), no + 1)) {
        let c = lc + pageCost(r, true) + stub(r, no + 1);
        if (!l.f.final && !r.f.final) c += Math.abs(l.dev - r.dev) * COST_UNEVEN;
        reach(n, [placed(l, no), placed(r, no + 1)], r, c);
      }
    }
  }
  let end: SearchNode | null = goal;
  if (!end) {
    // Out of budget (a very long chapter with many ways to go): finish greedily from the furthest point reached.
    let n = deepest;
    for (;;) {
      const no = n.pageNo;
      const f = fill(n.items, n.i, cap(no), foot, unit, true);
      if (!f) break;
      const o: PageOpt = { items: n.items, f, dev: f.final ? 0 : -f.short, alts: 0 };
      n = { items: n.items, i: firstBox(n.items, f.end + 1), pageNo: no + 1, cost: n.cost, parent: n, pages: [placed(o, no)], done: false };
    }
    end = n;
  }
  const chain: PlacedPage[] = [];
  for (let n: SearchNode | null = end; n; n = n.parent) chain.unshift(...n.pages);
  return chain.map((p) => emit(p.items, p.f, p.cap + p.dev * unit, p.cap, foot, unit, p.dev));
}

export function emptyStats(): PageStats {
  return { lines: 0, loose: 0, veryLoose: 0, hyphens: 0, ladders: 0, short: 0, long: 0, hyphenEnd: 0, orphans: 0, widows: 0, adjusted: 0 };
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
  if (d.kind === "rect" || d.kind === "gradient") return { ...d, x: d.x + dx, y: d.y + dy };
  if (d.kind === "path") return { ...d, ops: d.ops.map((o) => (o[0] === "Z" ? o : o[0] === "C" ? ["C", o[1] + dx, o[2] + dy, o[3] + dx, o[4] + dy, o[5] + dx, o[6] + dy] : [o[0], o[1] + dx, o[2] + dy])) };
  return { ...d, x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy };
}

export const NO_BREAK = INFINITE_PENALTY;
