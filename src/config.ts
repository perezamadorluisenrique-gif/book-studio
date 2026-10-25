// Build-time settings, set by esbuild.config.mjs from environment variables.
// `typeof` guards keep tests and unbundled runs working without the defines.

/**
 * The free edition has no Pro plan at all: Pro options are hidden rather than
 * locked, there is no license screen and the app makes no network requests.
 */
export const FREE_EDITION: boolean = typeof __FREE_EDITION__ === "boolean" ? __FREE_EDITION__ : false;

/** Prototype builds let people switch to Pro without a key, to try it. */
export const PRO_PREVIEW: boolean = !FREE_EDITION && typeof __PRO_PREVIEW__ === "boolean" ? __PRO_PREVIEW__ : false;

/** Polar organization that issues Pro keys; empty means licensing is off in this build. */
export const POLAR_ORGANIZATION_ID: string = typeof __POLAR_ORG_ID__ === "string" ? __POLAR_ORG_ID__ : "";

/** Where "Get Pro" links to. */
export const CHECKOUT_URL: string = typeof __CHECKOUT_URL__ === "string" && __CHECKOUT_URL__ ? __CHECKOUT_URL__ : "https://polar.sh";

export const PRODUCT_NAME = "Book Studio";
/** The release version, from manifest.json, for the PDF producer and EPUB generator fields. */
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
