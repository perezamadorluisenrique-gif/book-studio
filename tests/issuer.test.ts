import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handle, type Fetcher, type IssuerEnv } from "../issuer/issue";
import { verifyLicense } from "../src/engine/license-offline";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const hex = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString("hex");
const ORIGIN = "https://pages.example";
const CHECKOUT = "0b3c1f2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const PRODUCT = "11111111-2222-4333-8444-555555555555";

const env: IssuerEnv = {
  LICENSE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  KEY_ID: "t1",
  POLAR_ACCESS_TOKEN: "polar-test-token",
  POLAR_PRODUCT_ID: PRODUCT,
  ALLOWED_ORIGIN: ORIGIN,
};
const trust = { keys: { t1: hex }, revoked: [] as string[] };

const checkout = (over: Record<string, unknown> = {}) => ({ id: CHECKOUT, status: "succeeded", product_id: PRODUCT, customer_name: "Ada Writer", created_at: "2026-11-20T10:00:00Z", ...over });
const polar = (body: unknown, status = 200): Fetcher => async () => ({ ok: status < 400, status, json: async () => body });
const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request("https://issuer.example/activate", { method: "POST", headers: origin ? { origin, "content-type": "application/json" } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("license issuer", () => {
  it("returns a key the plugin verifies for a paid checkout", async () => {
    const res = await handle(post({ checkout: CHECKOUT }), env, polar(checkout()));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { token, name } = (await res.json()) as { token: string; name: string };
    expect(name).toBe("Ada Writer");
    const check = verifyLicense(token, trust);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.payload).toEqual({ v: 1, kid: "t1", ed: "pro", oid: CHECKOUT, iat: "2026-11-20", n: "Ada Writer" });
  });

  it("gives the same key every time, so a lost key is just the same link again", async () => {
    const a = (await (await handle(post({ checkout: CHECKOUT }), env, polar(checkout()))).json()) as unknown;
    const b = (await (await handle(post({ checkout: CHECKOUT.toUpperCase() }), env, polar(checkout()))).json()) as unknown;
    expect(b).toEqual(a);
  });

  it("asks Polar with the access token and nothing else about the buyer", async () => {
    let seen: { url: string; auth: string } | undefined;
    const spy: Fetcher = async (url, init) => ((seen = { url, auth: init.headers.authorization }), { ok: true, status: 200, json: async () => checkout() });
    await handle(post({ checkout: CHECKOUT }), env, spy);
    expect(seen).toEqual({ url: `https://api.polar.sh/v1/checkouts/${CHECKOUT}`, auth: "Bearer polar-test-token" });
  });

  it("refuses unpaid, pending, other-product and revoked checkouts", async () => {
    expect((await handle(post({ checkout: CHECKOUT }), env, polar(checkout({ status: "open" })))).status).toBe(402);
    const pending = await handle(post({ checkout: CHECKOUT }), env, polar(checkout({ status: "confirmed" })));
    expect(((await pending.json()) as { error: string }).error).toBe("payment-pending");
    expect((await handle(post({ checkout: CHECKOUT }), env, polar(checkout({ product_id: "other" })))).status).toBe(403);
    expect((await handle(post({ checkout: CHECKOUT }), { ...env, REVOKED_CHECKOUTS: `x, ${CHECKOUT}` }, polar(checkout()))).status).toBe(403);
  });

  it("answers unknown checkouts and Polar outages without leaking details", async () => {
    expect((await handle(post({ checkout: CHECKOUT }), env, polar({}, 404))).status).toBe(404);
    expect((await handle(post({ checkout: CHECKOUT }), env, polar({}, 500))).status).toBe(502);
    const down: Fetcher = async () => {
      throw new Error("secret detail polar-test-token");
    };
    const res = await handle(post({ checkout: CHECKOUT }), env, down);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("polar-test-token");
  });

  it("only talks to the activation page", async () => {
    expect((await handle(post({ checkout: CHECKOUT }, "https://evil.example"), env, polar(checkout()))).status).toBe(403);
    expect((await handle(post({ checkout: CHECKOUT }, null), env, polar(checkout()))).status).toBe(403);
    const pre = await handle(new Request("https://issuer.example/activate", { method: "OPTIONS", headers: { origin: ORIGIN } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const evil = await handle(new Request("https://issuer.example/activate", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects malformed requests before calling Polar", async () => {
    const never: Fetcher = async () => {
      throw new Error("must not be called");
    };
    expect((await handle(post("{not json"), env, never)).status).toBe(400);
    expect((await handle(post({ checkout: "../../orders" }), env, never)).status).toBe(400);
    expect((await handle(post({}), env, never)).status).toBe(400);
    expect((await handle(post({ checkout: "x".repeat(2000) }), env, never)).status).toBe(413);
    expect((await handle(new Request("https://issuer.example/activate", { method: "GET", headers: { origin: ORIGIN } }), env, never)).status).toBe(405);
    expect((await handle(new Request("https://issuer.example/other"), env, never)).status).toBe(404);
    expect((await handle(new Request("https://issuer.example/health"), env, never)).status).toBe(200);
  });

  it("keeps a buyer's name short and printable on the license", async () => {
    const res = await handle(post({ checkout: CHECKOUT }), env, polar(checkout({ customer_name: `  Ada\u0000\n  ${"W".repeat(200)} ` })));
    const { name } = (await res.json()) as { name: string };
    expect(name.length).toBeLessThanOrEqual(80);
    expect(Array.from(name).some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
    const noName = (await (await handle(post({ checkout: CHECKOUT }), env, polar(checkout({ customer_name: null })))).json()) as unknown;
    expect((noName as { name: null }).name).toBeNull();
  });
});
