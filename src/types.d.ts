declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "hyphen/*" {
  export function hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string;
}

declare const __FREE_EDITION__: boolean;
declare const __PRO_PREVIEW__: boolean;
declare const __POLAR_ORG_ID__: string;
declare const __CHECKOUT_URL__: string;
declare const __VERSION__: string;
