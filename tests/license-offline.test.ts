import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILT_IN_TRUST, describeFailure, describeLicense, normalizeLicense, planFromLicense, toBase64Url, verifyLicense, type LicenseTrust } from "../src/engine/license-offline";

// Licenses are signed here with Node's crypto and checked by the plugin's own noble-based verifier,
// so the test covers the same split as production (tools/license.mjs signs, the plugin verifies).
const pair = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const hex = (k: KeyObject) => Buffer.from((k.export({ format: "jwk" }) as { x: string }).x, "base64url").toString("hex");

function issue(payload: Record<string, unknown>, key: KeyObject = pair.privateKey): string {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `BS1.${body}.${toBase64Url(sign(null, Buffer.from(body), key))}`;
}

const base = { v: 1, kid: "k1", ed: "pro", oid: "ord-1", iat: "2026-11-20", n: "Ada L." };
const trust: LicenseTrust = { keys: { k1: hex(pair.publicKey) }, revoked: ["ord-revoked"] };

describe("verifyLicense", () => {
  it("accepts a signed license and reads its payload", () => {
    const r = verifyLicense(issue(base), trust);
    expect(r).toEqual({ ok: true, payload: base });
    expect(planFromLicense(issue(base), trust)).toBe("pro");
  });

  it("ignores spaces, line breaks and quotes from copy and paste", () => {
    const t = issue(base);
    const messy = `  "${t.slice(0, 60)}\n${t.slice(60, 120)}\r\n ${t.slice(120)}" \n`;
    expect(verifyLicense(messy, trust).ok).toBe(true);
    expect(normalizeLicense(messy)).toBe(t);
  });

  it("works without a name", () => {
    const { n: _n, ...noName } = base;
    expect(verifyLicense(issue(noName), trust).ok).toBe(true);
  });

  it("rejects a payload edited after signing", () => {
    const t = issue(base);
    const [p, body, sig] = t.split(".");
    const forged = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...base, oid: "ord-2" })));
    expect(verifyLicense([p, forged, sig].join("."), trust)).toEqual({ ok: false, reason: "signature" });
    // one flipped character in the signature
    const flipped = sig.slice(0, -2) + (sig.endsWith("A") ? "B" : "A") + sig.slice(-1);
    expect(verifyLicense([p, body, flipped].join("."), trust)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a license signed by another key", () => {
    expect(verifyLicense(issue(base, other.privateKey), trust)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects unknown key ids and prototype-property key ids", () => {
    expect(verifyLicense(issue({ ...base, kid: "zzz" }), trust)).toEqual({ ok: false, reason: "unknown-key" });
    expect(verifyLicense(issue({ ...base, kid: "constructor" }), trust)).toEqual({ ok: false, reason: "unknown-key" });
    expect(verifyLicense(issue({ ...base, kid: "__proto__" }), trust)).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("tells a future license version from a broken one", () => {
    expect(verifyLicense(issue({ ...base, v: 2 }), trust)).toEqual({ ok: false, reason: "version" });
    expect(verifyLicense("BS2.abc.def", trust)).toEqual({ ok: false, reason: "version" });
    expect(verifyLicense(issue({ ...base, ed: "team" }), trust)).toEqual({ ok: false, reason: "version" });
  });

  it("reports malformed input as a format problem, never throwing", () => {
    for (const bad of ["hello", "BS1.", "BS1.a.b", "BS1.@@@.###", "BS1.eyJ2IjoxfQ.AAAA", "BS1." + toBase64Url(new TextEncoder().encode("not json")) + "." + "A".repeat(86), "a.b.c.d"]) {
      const r = verifyLicense(bad, trust);
      expect(r.ok, bad).toBe(false);
    }
    expect(verifyLicense("   ", trust)).toEqual({ ok: false, reason: "empty" });
    expect(verifyLicense("BS1.eyJ2IjoxfQ." + "A".repeat(86), trust)).toEqual({ ok: false, reason: "format" });
  });

  it("refuses a malformed public key instead of crashing", () => {
    expect(verifyLicense(issue(base), { keys: { k1: "nothex" }, revoked: [] })).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("revokes refunded orders", () => {
    expect(verifyLicense(issue({ ...base, oid: "ord-revoked" }), trust)).toEqual({ ok: false, reason: "revoked" });
  });

  it("has no expiry, so the device clock is irrelevant", () => {
    const old = issue({ ...base, iat: "1999-01-01" });
    expect(verifyLicense(old, trust).ok).toBe(true);
    expect(verifyLicense(issue({ ...base, iat: "2999-01-01" }), trust).ok).toBe(true);
  });
});

describe("plan and wording", () => {
  it("is free without a license or with a bad one", () => {
    expect(planFromLicense(undefined, trust)).toBe("free");
    expect(planFromLicense("", trust)).toBe("free");
    expect(planFromLicense("BS1.x.y", trust)).toBe("free");
  });

  it("describes each outcome in plain words", () => {
    expect(describeLicense(undefined, trust)).toMatch(/No license key/);
    expect(describeLicense(issue(base), trust)).toBe("Book Studio Pro is active for Ada L. (order ord-1, issued 2026-11-20). It works offline and never expires.");
    expect(describeLicense("BS1.x.y", trust)).toMatch(/free plan/);
    expect(describeFailure("signature")).not.toMatch(/you (did|made)/i);
  });

  it("ships with no accepted key until the maintainer adds one, and nothing revoked", () => {
    // Every key that is listed must be a well-formed 32-byte public key.
    for (const k of Object.values(BUILT_IN_TRUST.keys)) expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(planFromLicense(issue(base), BUILT_IN_TRUST)).toBe("free");
  });
});
