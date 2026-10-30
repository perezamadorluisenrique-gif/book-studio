// Build-time settings, set by esbuild.config.mjs from environment variables.
// `typeof` guards keep tests and unbundled runs working without the defines.

/**
 * The community edition has no Pro plan at all: Pro options are hidden rather
 * than locked and there is no license screen. The default build is the full
 * one, where Pro is unlocked by a license key checked on the device.
 */
export const FREE_EDITION: boolean = typeof __FREE_EDITION__ === "boolean" ? __FREE_EDITION__ : false;

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
 * Where "Get Pro" links to. Empty until the Pro product exists, and then the
 * panel says Pro isn't on sale yet instead of linking anywhere.
 */
export const CHECKOUT_URL: string = typeof __CHECKOUT_URL__ === "string" ? __CHECKOUT_URL__ : "";

/** The page where a buyer swaps the store's receipt for a license key. */
export const ACTIVATE_URL: string = typeof __ACTIVATE_URL__ === "string" ? __ACTIVATE_URL__ : "";

export const PRODUCT_NAME = "Book Studio";
/** The release version, from manifest.json, for the PDF producer and EPUB generator fields. */
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
