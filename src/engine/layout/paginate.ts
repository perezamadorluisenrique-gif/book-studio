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

export function paginate(items: VItem[], capacity: number): FlowPage[] {
  const pages: FlowPage[] = [];
  const n = items.length;
  let i = 0;
  const eps = 0.01;
  while (i < n) {
    while (i < n && items[i].type !== "box") i++;
    if (i >= n) break;
    let h = 0;
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
      if (h + it.height > capacity + eps) break;
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
    pages.push(page);
    i = end + 1;
  }
  return pages;
}

export function offsetDraw(d: Draw, dx: number, dy: number): Draw {
  if (d.kind === "text") return { ...d, x: d.x + dx, y: d.y + dy };
  if (d.kind === "image") return { ...d, x: d.x + dx, y: d.y + dy };
  return { ...d, x1: d.x1 + dx, x2: d.x2 + dx, y1: d.y1 + dy, y2: d.y2 + dy };
}

export const NO_BREAK = INFINITE_PENALTY;
