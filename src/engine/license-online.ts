// Licence keys sold through a payment service, checked once when the user presses
// Activate. Source of truth: obsidian-dev/tools/pro-license/license-online.ts. Each
// Pro keeps a byte-identical copy as src/license-online.ts (parity.test.mjs).
//
// One request, to the payment service's public licence endpoint, with no secret.
// Nothing is sent again later: the result is stored by the host and never
// re-checked, so a missing network never locks anyone out.
//
//   Polar         POST https://api.polar.sh/v1/customer-portal/license-keys/validate  {key, organization_id}
//   Lemon Squeezy POST https://api.lemonsqueezy.com/v1/licenses/validate              license_key
//   Gumroad       POST https://api.gumroad.com/v2/licenses/verify                     product_id, license_key

export type Provider = 'polar' | 'lemonsqueezy' | 'gumroad';

export interface OnlineConfig {
  /** '' while no payment service is connected. */
  provider: Provider | '';
  /** Polar organization id, or Lemon Squeezy store id. Not secret. */
  accountId: string;
  /** Polar benefit id, Lemon Squeezy product id or Gumroad product id. Not secret. */
  productId: string;
  /** Only for tests and e2e: replaces the service's origin. Release builds pass ''. */
  apiBase?: string;
}

export interface PostRequest {
  url: string;
  contentType: 'application/json' | 'application/x-www-form-urlencoded';
  body: string;
}

export interface PostResponse {
  status: number;
  /** Parsed JSON body, or null when it was not JSON. */
  json: unknown;
}

/** The host's HTTP call (requestUrl in Obsidian, fetch on the web). Throws on network failure. */
export type Post = (request: PostRequest) => Promise<PostResponse>;

export type OnlineResult =
  | { ok: true; provider: Provider }
  | { ok: false; reason: 'not-configured' | 'empty' | 'invalid' | 'wrong-product' | 'refunded' | 'network' | 'service' };

const ORIGINS: Record<Provider, string> = {
  polar: 'https://api.polar.sh',
  lemonsqueezy: 'https://api.lemonsqueezy.com',
  gumroad: 'https://api.gumroad.com',
};

export function isConfigured(cfg: OnlineConfig): boolean {
  if (cfg.provider === '' || cfg.productId.trim() === '') return false;
  if (cfg.provider === 'gumroad') return true;
  return cfg.accountId.trim() !== '';
}

function form(fields: Record<string, string>): string {
  return Object.keys(fields)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`)
    .join('&');
}

function field(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const same = (a: unknown, b: string): boolean => (typeof a === 'string' || typeof a === 'number') && String(a) === b.trim();

/** The request for a key, or null when the configuration is incomplete. */
export function buildRequest(key: string, cfg: OnlineConfig): PostRequest | null {
  if (!isConfigured(cfg)) return null;
  const provider = cfg.provider as Provider;
  const origin = (cfg.apiBase && cfg.apiBase !== '' ? cfg.apiBase : ORIGINS[provider]).replace(/\/+$/, '');
  if (provider === 'polar') {
    return {
      url: `${origin}/v1/customer-portal/license-keys/validate`,
      contentType: 'application/json',
      body: JSON.stringify({ key, organization_id: cfg.accountId.trim() }),
    };
  }
  if (provider === 'lemonsqueezy') {
    return { url: `${origin}/v1/licenses/validate`, contentType: 'application/x-www-form-urlencoded', body: form({ license_key: key }) };
  }
  return {
    url: `${origin}/v2/licenses/verify`,
    contentType: 'application/x-www-form-urlencoded',
    body: form({ product_id: cfg.productId.trim(), license_key: key, increment_uses_count: 'false' }),
  };
}

/** What a service's answer means. Pure, so each service's shape is tested without a network. */
export function readResponse(provider: Provider, cfg: OnlineConfig, res: PostResponse, now: Date): OnlineResult {
  const body = res.json;
  if (provider === 'polar') {
    if (res.status === 404 || res.status === 422 || res.status === 400) return { ok: false, reason: 'invalid' };
    if (res.status !== 200) return { ok: false, reason: 'service' };
    if (field(body, 'status') !== 'granted') return { ok: false, reason: 'invalid' };
    if (!same(field(body, 'benefit_id'), cfg.productId)) return { ok: false, reason: 'wrong-product' };
    const expires = field(body, 'expires_at');
    if (typeof expires === 'string' && Date.parse(expires) <= now.getTime()) return { ok: false, reason: 'invalid' };
    return { ok: true, provider };
  }
  if (provider === 'lemonsqueezy') {
    // Lemon Squeezy answers 400/404 with valid:false for unknown keys.
    if (res.status >= 500 || body === null) return { ok: false, reason: 'service' };
    if (field(body, 'valid') !== true) return { ok: false, reason: 'invalid' };
    if (!same(field(body, 'meta', 'store_id'), cfg.accountId) || !same(field(body, 'meta', 'product_id'), cfg.productId)) {
      return { ok: false, reason: 'wrong-product' };
    }
    const status = field(body, 'license_key', 'status');
    if (status === 'disabled' || status === 'expired') return { ok: false, reason: 'invalid' };
    return { ok: true, provider };
  }
  // Gumroad answers 404 with success:false for unknown keys and other products.
  if (res.status >= 500 || body === null) return { ok: false, reason: 'service' };
  if (field(body, 'success') !== true) return { ok: false, reason: 'invalid' };
  if (field(body, 'purchase', 'refunded') === true || field(body, 'purchase', 'chargebacked') === true) return { ok: false, reason: 'refunded' };
  const product = field(body, 'purchase', 'product_id');
  if (product !== undefined && !same(product, cfg.productId)) return { ok: false, reason: 'wrong-product' };
  return { ok: true, provider };
}

/** Checks a key with the payment service. Never throws. */
export async function validateOnline(rawKey: string, cfg: OnlineConfig, post: Post, now: Date = new Date()): Promise<OnlineResult> {
  const key = rawKey.trim();
  if (key === '') return { ok: false, reason: 'empty' };
  const request = buildRequest(key, cfg);
  if (request === null) return { ok: false, reason: 'not-configured' };
  let res: PostResponse;
  try {
    res = await post(request);
  } catch {
    return { ok: false, reason: 'network' };
  }
  return readResponse(cfg.provider as Provider, cfg, res, now);
}

/** One sentence for the settings screen. */
export function describeFailure(reason: Exclude<OnlineResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'not-configured':
      return 'Licence activation is not available in this build yet.';
    case 'empty':
      return 'Paste your licence key first.';
    case 'invalid':
      return 'This licence key was not recognised. Check that it was copied in full.';
    case 'wrong-product':
      return 'This licence key belongs to a different product.';
    case 'refunded':
      return 'This licence key belongs to a refunded purchase.';
    case 'network':
      return 'Could not reach the payment service. Check your connection and try again.';
    case 'service':
      return 'The payment service did not answer as expected. Try again later.';
  }
}
