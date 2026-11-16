// Pure operations on a book's style changes (StyleOverrides). The panel only calls these; the limits themselves
// live in resolveTheme(), so a value typed past a limit is shown at the limit the book really uses.

import { kdpMinInside } from "./trims";
import type { StyleOverrides } from "./model";

export type StyleField = "size" | "leading" | "indent" | "dropCap" | "sceneBreak" | "top" | "bottom" | "outside" | "inside";

/** The changes with one field set; undefined removes it. A change that leaves nothing gives undefined. */
export function setStyleField(style: StyleOverrides | undefined, field: StyleField, value: number | string | undefined): StyleOverrides | undefined {
  const next: StyleOverrides = { ...style, margins: style?.margins ? { ...style.margins } : undefined };
  if (field === "top" || field === "bottom" || field === "outside" || field === "inside") {
    const margins = { ...next.margins };
    if (typeof value === "number") margins[field] = value;
    else delete margins[field];
    next.margins = Object.keys(margins).length ? margins : undefined;
  } else if (field === "sceneBreak") {
    if (typeof value === "string" && value) next.sceneBreak = value;
    else delete next.sceneBreak;
  } else if (field === "dropCap") {
    if (value === 0 || value === 2 || value === 3) next.dropCap = value;
    else delete next.dropCap;
  } else if (typeof value === "number") next[field] = value;
  else delete next[field];
  if (!next.margins) delete next.margins;
  return Object.keys(next).length ? next : undefined;
}

/** The inside margin, in inches, KDP asks for a book of this many pages. */
export const minInsideMargin = (pages: number): number => kdpMinInside(pages);
