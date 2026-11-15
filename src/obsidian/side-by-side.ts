// The free plugin and the paid edition are two plugins with their own ids, so a
// buyer can install the paid one next to the free one. Pure helpers, no Obsidian.

export const FREE_ID = "book-studio";
export const PAID_ID = "book-studio-pro";

/** The other edition's plugin id, or null for any other id. */
export function siblingOf(id: string): string | null {
  if (id === FREE_ID) return PAID_ID;
  if (id === PAID_ID) return FREE_ID;
  return null;
}

/** True when a plugin's saved data holds nothing yet (first run). */
export function isFirstRun(saved: unknown): boolean {
  return saved === null || saved === undefined || (typeof saved === "object" && Object.keys(saved).length === 0);
}

/**
 * The settings to start from on the paid edition's first run: the free
 * plugin's export folder, author and per-book choices, so nothing is set twice.
 * Null when there is nothing to take or this is not the paid edition.
 */
export function inheritedSettings(id: string, ownSaved: unknown, freeSaved: unknown): Record<string, unknown> | null {
  if (id !== PAID_ID || !isFirstRun(ownSaved)) return null;
  if (!freeSaved || typeof freeSaved !== "object" || Array.isArray(freeSaved)) return null;
  const out = { ...(freeSaved as Record<string, unknown>) };
  return Object.keys(out).length ? out : null;
}

/** The notice the paid edition shows once when the free one is also turned on, or null. */
export function bothOnNotice(id: string, enabled: ReadonlySet<string>): string | null {
  if (id !== PAID_ID || !enabled.has(FREE_ID)) return null;
  return "Book Studio is also turned on. This edition already includes everything in it, so you can turn Book Studio off in Settings → Community plugins.";
}
