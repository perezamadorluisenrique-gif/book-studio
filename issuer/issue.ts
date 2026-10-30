// The Book Studio Pro license issuer. It is the only part of Book Studio that
// touches the network, and it runs on a Cloudflare Worker, never in the plugin or
// the web app: the person pays on Polar, lands on the activation page, and the
// page asks this Worker for the key that belongs to that checkout.
//
// It keeps no state. The token is a pure function of the checkout (its id, the
// day it was created and the buyer's name), and Ed25519 signatures are
// deterministic, so asking twice returns the same key. A lost key is recovered
// by opening the same link again; there is no database to leak.
//
//   POST /activate   { "checkout": "<Polar checkout id>" }   ->   { "token": "BS1…", "name": "…" }
//
// The license format and its checks are in src/engine/license-offline.ts.

export interface IssuerEnv {
  /** PKCS8 PEM of the Ed25519 signing key (`node tools/license.mjs keygen`), kept as a Worker secret. */
  LICENSE_PRIVATE_KEY: string;
  /** Id of that key's public half in src/engine/license-keys.ts, e.g. "2026a". */
  KEY_ID: string;
  /** A Polar organization access token that can read checkouts, kept as a Worker secret. */
  POLAR_ACCESS_TOKEN: string;
  /** The Polar product that is Book Studio Pro; a checkout for any other product gets no key. */
  POLAR_PRODUCT_ID: string;
  /** The activation page's origin, e.g. https://perezamadorluisenrique-gif.github.io. Only it may call. */
  ALLOWED_ORIGIN: string;
  /** Polar's API, https://api.polar.sh unless testing against the sandbox. */
  POLAR_API?: string;
  /** Checkout ids refunded or charged back, separated by commas. They also go in REVOKED_ORDERS in the plugin. */
  REVOKED_CHECKOUTS?: string;
}

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1024;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export interface IssueInput {
  checkoutId: string;
  /** The day the checkout was created, as YYYY-MM-DD. */
  issued: string;
  name?: string;
}

/** Sign a license token. The payload and signature match what `tools/license.mjs sign` writes. */
export async function signLicense(env: Pick<IssuerEnv, "LICENSE_PRIVATE_KEY" | "KEY_ID">, input: IssueInput): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(env.LICENSE_PRIVATE_KEY), { name: "Ed25519" }, false, ["sign"]);
  const payload: Record<string, unknown> = { v: 1, kid: env.KEY_ID, ed: "pro", oid: input.checkoutId, iat: input.issued };
  if (input.name) payload.n = input.name;
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(body)));
  return `BS1.${body}.${bytesToBase64Url(sig)}`;
}

/** A buyer's name goes on their license, so keep it short and free of control characters. */
function cleanName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const printable = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("");
  const n = printable.replace(/\s+/g, " ").trim().slice(0, 80);
  return n || undefined;
}

function reply(status: number, body: unknown, env: IssuerEnv, origin: string | null): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

interface PolarCheckout {
  id?: unknown;
  status?: unknown;
  product_id?: unknown;
  customer_name?: unknown;
  created_at?: unknown;
}

export async function handle(request: Request, env: IssuerEnv, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const send = (status: number, body: unknown) => reply(status, body, env, origin);

  if (request.method === "OPTIONS") {
    const headers: Record<string, string> = { "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
    if (origin && origin === env.ALLOWED_ORIGIN) headers["access-control-allow-origin"] = origin;
    return new Response(null, { status: 204, headers });
  }
  if (url.pathname === "/health" && request.method === "GET") return send(200, { ok: true });
  if (url.pathname !== "/activate") return send(404, { error: "not-found" });
  if (request.method !== "POST") return send(405, { error: "method" });
  if (origin !== env.ALLOWED_ORIGIN) return send(403, { error: "origin" });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return send(413, { error: "too-large" });
  let checkoutId = "";
  try {
    const parsed = JSON.parse(raw) as { checkout?: unknown };
    checkoutId = typeof parsed.checkout === "string" ? parsed.checkout.trim() : "";
  } catch {
    return send(400, { error: "json" });
  }
  if (!UUID.test(checkoutId)) return send(400, { error: "checkout-id" });
  checkoutId = checkoutId.toLowerCase();
  if ((env.REVOKED_CHECKOUTS ?? "").split(",").map((s) => s.trim().toLowerCase()).includes(checkoutId)) return send(403, { error: "revoked" });

  let found;
  try {
    found = await fetcher(`${env.POLAR_API ?? "https://api.polar.sh"}/v1/checkouts/${checkoutId}`, { headers: { authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, accept: "application/json" } });
  } catch {
    return send(502, { error: "polar-unreachable" });
  }
  if (found.status === 404 || found.status === 422) return send(404, { error: "no-such-checkout" });
  if (!found.ok) return send(502, { error: "polar-error" });
  const checkout = (await found.json()) as PolarCheckout;

  if (checkout.product_id !== env.POLAR_PRODUCT_ID) return send(403, { error: "wrong-product" });
  // "confirmed" is a payment on its way: the page tells the buyer to wait a minute.
  if (checkout.status !== "succeeded") return send(402, { error: checkout.status === "confirmed" ? "payment-pending" : "not-paid" });

  const created = typeof checkout.created_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(checkout.created_at) ? checkout.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const name = cleanName(checkout.customer_name);
  try {
    const token = await signLicense(env, { checkoutId, issued: created, name });
    return send(200, { token, name: name ?? null });
  } catch {
    return send(500, { error: "signing" });
  }
}
