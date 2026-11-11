// Links between the tools, and from the tools into the app. Every number the visitor typed travels in the
// address (?pages=300&ink=bw_white&trim=6x9), so the next tool opens already filled in.

import { TRIMS } from "../../../src/engine/trims";
import type { Ink } from "./kdp";

/** The paper the app calls the same thing: standard colour has the spine of white paper. */
export const APP_PAPER: Record<Ink, "white" | "cream" | "color"> = { bw_white: "white", bw_cream: "cream", color_standard: "white", color_premium: "color" };

/** True when the app can set a book in this trim (it supports 12 of KDP's 16). */
export const appHasTrim = (id: string): boolean => TRIMS.some((t) => t.id === id);

export function query(values: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The app, ready to start a book in this size and on this paper. `root` is the path from the page to the site root. */
export function appLink(root: string, trim: string, ink: Ink): string {
  return `${root}${query({ start: "import", trim: appHasTrim(trim) ? trim : undefined, paper: APP_PAPER[ink] })}`;
}
