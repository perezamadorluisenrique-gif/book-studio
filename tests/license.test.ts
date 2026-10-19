import { describe, expect, it } from "vitest";
import { activateLicense, deactivateLicense, describeLicense, LicenseError, needsRevalidation, OFFLINE_GRACE, planFromLicense, REVALIDATE_AFTER, validateLicense, type HttpPost, type HttpResponse } from "../src/engine/license";

const cfg = { organizationId: "org-1", api: "https://polar.test/keys" };
const NOW = Date.parse("2026-10-19T12:00:00Z");

function fake(routes: Record<string, HttpResponse | (() => HttpResponse)>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const http: HttpPost = async (url, body) => {
    const path = url.slice(cfg.api.length + 1);
    calls.push({ path, body: body as Record<string, unknown> });
    const r = routes[path];
    if (!r) throw new Error("offline");
    return typeof r === "function" ? r() : r;
  };
  return { http, calls };
}

const grantedKey = { key: "BOOK-1234", display_key: "****-1234", status: "granted", expires_at: null, limit_activations: 3, customer: { name: "Ada", email: "ada@example.com" } };

describe("activateLicense", () => {
  it("activates and keeps the activation id", async () => {
    const { http, calls } = fake({ activate: { status: 200, json: { id: "act-9", license_key: grantedKey } } });
    const s = await activateLicense(http, cfg, "  BOOK-1234 ", "Obsidian", NOW);
    expect(calls[0]).toEqual({ path: "activate", body: { key: "BOOK-1234", label: "Obsidian", organization_id: "org-1" } });
    expect(s).toMatchObject({ key: "BOOK-1234", activationId: "act-9", status: "granted", validatedAt: NOW, customer: "Ada", displayKey: "****-1234" });
    expect(planFromLicense(s, NOW)).toBe("pro");
  });

  it("validates keys that don't use activations", async () => {
    const { http } = fake({ activate: { status: 403, json: {} }, validate: { status: 200, json: { ...grantedKey, limit_activations: null } } });
    const s = await activateLicense(http, cfg, "BOOK-1234", "Web", NOW);
    expect(s.activationId).toBeUndefined();
    expect(planFromLicense(s, NOW)).toBe("pro");
  });

  it("reports an exhausted activation limit", async () => {
    const { http } = fake({ activate: { status: 403, json: {} }, validate: { status: 200, json: grantedKey } });
    await expect(activateLicense(http, cfg, "BOOK-1234", "Web", NOW)).rejects.toMatchObject({ kind: "limit" });
  });

  it("rejects unknown keys and explains network failures", async () => {
    await expect(activateLicense(fake({ activate: { status: 404, json: {} } }).http, cfg, "nope", "Web", NOW)).rejects.toMatchObject({ kind: "rejected" });
    await expect(activateLicense(fake({}).http, cfg, "BOOK-1234", "Web", NOW)).rejects.toMatchObject({ kind: "network" });
    await expect(activateLicense(fake({}).http, { organizationId: "" }, "BOOK-1234", "Web", NOW)).rejects.toBeInstanceOf(LicenseError);
  });
});

describe("validateLicense", () => {
  const stored = { key: "BOOK-1234", activationId: "act-9", status: "granted" as const, validatedAt: NOW - REVALIDATE_AFTER - 1 };

  it("sends the activation id and refreshes the check time", async () => {
    const { http, calls } = fake({ validate: { status: 200, json: grantedKey } });
    expect(needsRevalidation(stored, NOW)).toBe(true);
    const s = await validateLicense(http, cfg, stored, NOW);
    expect(calls[0].body).toEqual({ key: "BOOK-1234", activation_id: "act-9", organization_id: "org-1" });
    expect(s.validatedAt).toBe(NOW);
    expect(needsRevalidation(s, NOW)).toBe(false);
  });

  it("marks revoked keys invalid", async () => {
    const s = await validateLicense(fake({ validate: { status: 404, json: {} } }).http, cfg, stored, NOW);
    expect(s.status).toBe("invalid");
    expect(planFromLicense(s, NOW)).toBe("free");
  });
});

describe("planFromLicense", () => {
  const base = { key: "K", status: "granted" as const, validatedAt: NOW };
  it("keeps Pro offline within the grace period, then drops to free", () => {
    expect(planFromLicense({ ...base, validatedAt: NOW - OFFLINE_GRACE + 1000 }, NOW)).toBe("pro");
    expect(planFromLicense({ ...base, validatedAt: NOW - OFFLINE_GRACE - 1000 }, NOW)).toBe("free");
  });
  it("respects expiry", () => {
    expect(planFromLicense({ ...base, expiresAt: NOW - 1 }, NOW)).toBe("free");
    expect(planFromLicense({ ...base, expiresAt: NOW + 1000 }, NOW)).toBe("pro");
    expect(planFromLicense(null, NOW)).toBe("free");
  });
  it("describes the state in a sentence", () => {
    expect(describeLicense(null)).toMatch(/free plan/);
    expect(describeLicense({ ...base, customer: "Ada", displayKey: "****-K" }, NOW)).toBe("Book Studio Pro is active for Ada (key ****-K).");
  });
});

describe("deactivateLicense", () => {
  it("frees the activation and tolerates one already gone", async () => {
    const { http, calls } = fake({ deactivate: { status: 204, json: null } });
    await deactivateLicense(http, cfg, { key: "K", activationId: "a", status: "granted", validatedAt: NOW });
    expect(calls[0].body).toEqual({ key: "K", activation_id: "a", organization_id: "org-1" });
    await deactivateLicense(fake({ deactivate: { status: 404, json: {} } }).http, cfg, { key: "K", activationId: "a", status: "granted", validatedAt: NOW });
  });
});
