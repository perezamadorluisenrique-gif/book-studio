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

export interface PaginateOptions {
  /** Line height of the body text, to count how many lines a page is short. */
  unit?: number;
}

/** `capacity` can depend on the page, for a flow that starts below a heading. */
export function paginate(items: VItem[], capacityOf: number | ((page: number) => number), foot?: FootnoteSource, opts: PaginateOptions = {}): FlowPage[] {
  const pages: FlowPage[] = [];
  const n = items.length;
  let i = 0;
  const eps = 0.01;
  while (i < n) {
    const capacity = typeof capacityOf === "number" ? capacityOf : capacityOf(pages.length);
    while (i < n && items[i].type !== "box") i++;
    if (i >= n) break;
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
    const page: FlowPage = { draws: [], used: 0, overflow, stats: emptyStats() };
    let y = 0;
    for (let k = i; k <= end; k++) {
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
      const ids = [...new Set(items.slice(i, end + 1).flatMap((it) => (it.type === "box" && it.notes ? it.notes : [])))];
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
    const final = j >= n || forced;
    page.stats = pageStats(items, i, end, page.used, capacity, final, opts.unit, foot);
    pages.push(page);
    i = end + 1;
  }
  return pages;
}

export function emptyStats(): PageStats {
  return { lines: 0, loose: 0, veryLoose: 0, hyphens: 0, ladders: 0, short: 0, hyphenEnd: 0, orphans: 0, widows: 0, adjusted: 0 };
}

function pageStats(items: VItem[], from: number, to: number, used: number, capacity: number, final: boolean, unit: number | undefined, foot?: FootnoteSource): PageStats {
  const st = emptyStats();
  const boxes: VBox[] = [];
  for (let k = from; k <= to; k++) {
    const it = items[k];
    if (it.type === "box") boxes.push(it);
  }
  let run = 0;
  for (const b of boxes) {
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
  if (last?.q?.hyphen) st.hyphenEnd = 1;
  if (last?.q && last.para === 1 && (last.paraLines ?? 1) > 1) st.orphans = 1;
  if (first?.q && first.para === first.paraLines && (first.paraLines ?? 1) > 1) st.widows = 1;
  if (unit && !final) {
    let notes = 0;
    if (foot) {
      const ids = [...new Set(boxes.flatMap((b) => b.notes ?? []))];
      if (ids.length) notes = foot.separator + ids.reduce((a, id) => a + foot.height(id), 0);
    }
    st.short = Math.max(0, Math.floor((capacity - used - notes + 0.01) / unit));
  }
  return st;
}

export function offsetDraw(d: Draw, dx: number, dy: number): Draw {
  if (d.kind === "text") return { ...d, x: d.x + dx, y: d.y + dy };
  if (d.kind === "image") return { ...d, x: d.x + dx, y: d.y + dy, clip: d.clip && { ...d.clip, x: d.clip.x + dx, y: d.clip.y + dy } };
  if (d.kind === "rect") return { ...d, x: d.x + dx, y: d.y + dy };
  return { ...d, x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy };
}

export const NO_BREAK = INFINITE_PENALTY;
