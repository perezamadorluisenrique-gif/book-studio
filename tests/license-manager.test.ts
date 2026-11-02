import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LicenseError, LicenseManager } from "../src/app/license-manager";
import { toBase64Url, type LicenseTrust } from "../src/engine/license-offline";
import type { OnlineConfig, Post, PostRequest } from "../src/engine/license-online";

const configured: OnlineConfig = { provider: "polar", accountId: "org-1", productId: "benefit-1" };
const unconfigured: OnlineConfig = { provider: "", accountId: "", productId: "" };

function memoryHost() {
  const data = new Map<string, unknown>();
  return {
    store: {
      get: <T>(k: string) => data.get(k) as T | undefined,
      set: (k: string, v: unknown) => void (v === undefined ? data.delete(k) : data.set(k, v)),
    },
  };
}

function fakePost(status: number, json: unknown, seen: PostRequest[] = []): Post {
  return async (r) => {
    seen.push(r);
    return { status, json };
  };
}
const down: Post = async () => {
  throw new Error("offline");
};
const granted = { status: "granted", benefit_id: "benefit-1", expires_at: null };

const failure = async (m: LicenseManager, key: string, post: Post): Promise<string> => {
  try {
    await m.activate(key, post);
  } catch (e) {
    expect(e).toBeInstanceOf(LicenseError);
    return (e as Error).message;
  }
  throw new Error("activate did not fail");
};

describe("LicenseManager.activate with the payment service", () => {
  it("accepts a valid key, stores key, provider and date, and the plan becomes pro", async () => {
    const host = memoryHost();
    const m = new LicenseManager(host, () => configured);
    const seen: PostRequest[] = [];
    let changes = 0;
    m.onChange(() => changes++);
    expect(m.plan()).toBe("free");
    await m.activate("  KEY-123 ", fakePost(200, granted, seen));
    expect(seen).toHaveLength(1);
    expect(m.plan()).toBe("pro");
    expect(m.key).toBe("KEY-123");
    expect(changes).toBe(1);
    const stored = host.store.get<{ key: string; provider: string; validatedAt: string }>("license");
    expect(stored).toMatchObject({ key: "KEY-123", provider: "polar" });
    expect(Number.isNaN(Date.parse(stored!.validatedAt))).toBe(false);
    expect(m.describe()).toMatch(/active/);
  });

  it("never asks the service again once stored", async () => {
    const host = memoryHost();
    await new LicenseManager(host, () => configured).activate("KEY-123", fakePost(200, granted));
    const later = new LicenseManager(host, () => configured);
    expect(later.plan()).toBe("pro");
    expect(later.describe()).toMatch(/active/);
  });

  it("rejects an unknown key and stores nothing", async () => {
    const host = memoryHost();
    const m = new LicenseManager(host, () => configured);
    expect(await failure(m, "nope", fakePost(404, { detail: "ResourceNotFound" }))).toMatch(/not recognised/);
    expect(m.plan()).toBe("free");
    expect(host.store.get("license")).toBeUndefined();
  });

  it("rejects a key for another product", async () => {
    const m = new LicenseManager(memoryHost(), () => configured);
    expect(await failure(m, "k", fakePost(200, { ...granted, benefit_id: "other" }))).toMatch(/different product/);
    expect(m.plan()).toBe("free");
  });

  it("reports a network failure and stays free", async () => {
    const m = new LicenseManager(memoryHost(), () => configured);
    expect(await failure(m, "k", down)).toMatch(/Could not reach/);
    expect(m.plan()).toBe("free");
  });

  it("says activation is unavailable when the build is not configured, without calling out", async () => {
    const m = new LicenseManager(memoryHost(), () => unconfigured);
    const seen: PostRequest[] = [];
    expect(await failure(m, "k", fakePost(200, granted, seen))).toMatch(/not available/);
    expect(seen).toHaveLength(0);
  });

  it("asks for a key when the field is empty", async () => {
    const m = new LicenseManager(memoryHost(), () => configured);
    expect(await failure(m, "   ", fakePost(200, granted))).toMatch(/Paste your licence key/);
  });

  it("remove() goes back to the free plan", async () => {
    const m = new LicenseManager(memoryHost(), () => configured);
    await m.activate("k", fakePost(200, granted));
    m.remove();
    expect(m.plan()).toBe("free");
    expect(m.key).toBeUndefined();
  });
});

describe("LicenseManager.activate with an offline key", () => {
  const pair = generateKeyPairSync("ed25519");
  const hex = (k: KeyObject) => Buffer.from((k.export({ format: "jwk" }) as { x: string }).x, "base64url").toString("hex");
  const trust: LicenseTrust = { keys: { k1: hex(pair.publicKey) }, revoked: [] };
  const payload = { v: 1, kid: "k1", ed: "pro", oid: "ord-1", iat: "2026-11-20", n: "Ada L." };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const token = `BS1.${body}.${toBase64Url(sign(null, Buffer.from(body), pair.privateKey))}`;

  it("still works, as a plain string, without touching the network", async () => {
    const host = memoryHost();
    const m = new LicenseManager(host, () => unconfigured, trust);
    const seen: PostRequest[] = [];
    await m.activate(token, fakePost(500, null, seen));
    expect(seen).toHaveLength(0);
    expect(host.store.get("license")).toBe(token);
    expect(m.plan()).toBe("pro");
    expect(m.holder?.oid).toBe("ord-1");
  });

  it("explains a bad offline key with the offline message", async () => {
    const m = new LicenseManager(memoryHost(), () => configured, trust);
    expect(await failure(m, token.slice(0, -4) + "AAAA", fakePost(404, null))).not.toMatch(/payment service/);
  });
});
