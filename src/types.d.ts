declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "hyphen/*" {
  export function hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string;
}

declare const __FREE_EDITION__: boolean;
declare const __PRO_PREVIEW__: boolean;
declare const __EXTRA_PUBLIC_KEYS__: string;
declare const __PRO_LICENSE_TEST__: import("./engine/license-online").OnlineConfig | null;
declare const __VERSION__: string;
