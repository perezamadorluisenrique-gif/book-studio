// The free edition has no sales-kit screen. The Pro overlay replaces this file.

import type { Built } from "./pipeline";
import type { StudioHost } from "./host";
import type { FontSet } from "../engine/fonts";
import type { PagePainter } from "../preview/canvas";

export interface MarketingContext {
  host: StudioHost;
  built(): Built | null;
  fonts(): Promise<FontSet>;
  painter(): PagePainter | null;
  plan(): "free" | "pro";
}

export interface MarketingPanel {
  /** The book was rebuilt: draw again. */
  refresh(): void;
  dispose(): void;
}

export function mountMarketingPanel(_box: HTMLElement, _ctx: MarketingContext): MarketingPanel {
  return { refresh() {}, dispose() {} };
}
