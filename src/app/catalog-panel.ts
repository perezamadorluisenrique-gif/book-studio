// The free edition has no catalog screen. The Pro overlay replaces this file.

import type { StudioHost } from "./host";

export type Disposer = () => void;

export interface CatalogContext {
  studio: StudioHost;
  close(): void;
  plan(): "free" | "pro";
}

export function mountCatalogPanel(_box: HTMLElement, _ctx: CatalogContext): Disposer {
  return () => {};
}
