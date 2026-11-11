// The free edition has no licences. Only the types the hosts share are here; the
// Pro overlay replaces this file with the real licence check.

export type Provider = "polar" | "lemonsqueezy" | "gumroad";

export interface OnlineConfig {
  provider: Provider | "";
  accountId: string;
  productId: string;
  apiBase?: string;
}

export interface PostRequest {
  url: string;
  contentType: "application/json" | "application/x-www-form-urlencoded";
  body: string;
}

export interface PostResponse {
  status: number;
  json: unknown;
}

/** The host's HTTP call (requestUrl in Obsidian, fetch on the web). */
export type Post = (request: PostRequest) => Promise<PostResponse>;
