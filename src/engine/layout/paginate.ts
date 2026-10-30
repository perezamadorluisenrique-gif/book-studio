// Vertical material and the page builder. Every box carries a penalty for a
// page break after it: widow/orphan control and keep-with-next are encoded there,
// and discardable spaces vanish at page tops and bottoms.

import { INFINITE_PENALTY } from "../linebreak";
import type { SourceRef } from "../model";
import type { Draw, TextPos } from "./types";

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
}

/** `capacity` can depend on the page, for a flow that starts below a heading. */
export function paginate(items: VItem[], capacityOf: number | ((page: number) => number), foot?: FootnoteSource): FlowPage[] {
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
    const page: FlowPage = { draws: [], used: 0, overflow };
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
    pages.push(page);
    i = end + 1;
  }
  return pages;
}

export function offsetDraw(d: Draw, dx: number, dy: number): Draw {
  if (d.kind === "text") return { ...d, x: d.x + dx, y: d.y + dy };
  if (d.kind === "image") return { ...d, x: d.x + dx, y: d.y + dy, clip: d.clip && { ...d.clip, x: d.clip.x + dx, y: d.clip.y + dy } };
  if (d.kind === "rect") return { ...d, x: d.x + dx, y: d.y + dy };
  return { ...d, x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy };
}

export const NO_BREAK = INFINITE_PENALTY;
