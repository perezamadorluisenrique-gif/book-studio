import { PRO_INCLUDED } from "./edition";
import type { OnlineConfig } from "./engine/license-online";

// Build-time settings, set by esbuild.config.mjs from environment variables.
// `typeof` guards keep tests and unbundled runs working without the defines.

/**
 * The free edition has no Pro plan at all: Pro options are hidden rather than
 * locked and there is no license screen. It is what this public repository
 * builds. Only a tree with the private Pro overlay (src/edition.ts says so)
 * builds the full edition, where Pro is unlocked by a license key; such a
 * tree can still build the free one with BOOK_STUDIO_EDITION=community.
 */
export const FREE_EDITION: boolean = typeof __FREE_EDITION__ === "boolean" ? __FREE_EDITION__ : !PRO_INCLUDED;

/** Developer builds can switch Pro on without a key, to try it; never set for a release. */
export const PRO_PREVIEW: boolean = !FREE_EDITION && typeof __PRO_PREVIEW__ === "boolean" ? __PRO_PREVIEW__ : false;

/**
 * Extra license public keys for test builds, "kid:hex,kid:hex". Empty in a
 * release, so only the keys listed in engine/license-keys.ts count.
 */
export const EXTRA_PUBLIC_KEYS: Record<string, string> = Object.fromEntries(
  (typeof __EXTRA_PUBLIC_KEYS__ === "string" ? __EXTRA_PUBLIC_KEYS__ : "")
    .split(",")
    .map((p) => p.split(":").map((x) => x.trim()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
);

/**
 * Only for e2e: the licence settings that point at a local stand-in for the
 * payment service. Null in a release (esbuild's PRO_LICENSE_TEST_API is unset).
 */
export const PRO_LICENSE_TEST: OnlineConfig | null = typeof __PRO_LICENSE_TEST__ === "object" ? __PRO_LICENSE_TEST__ : null;

export const PRODUCT_NAME = "Book Studio";
/** The release version, from manifest.json, for the PDF producer and EPUB generator fields. */
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
