// Pro licenses are signed tokens that the plugin checks on the device, with no
// network at all, no expiry and so no dependence on the clock:
//
//   BS1.<base64url(payload JSON)>.<base64url(Ed25519 signature, 64 bytes)>
//   payload = { v: 1, kid: "2026a", ed: "pro", oid: "<order id>", iat: "2026-11-20", n: "<optional name>" }
//
// The signature covers the exact bytes of the base64url payload text, so there is
// nothing to canonicalize. Keys are looked up by `kid`, which lets the signing
// key rotate without invalidating licenses already sold.

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import type { Plan } from "./entitlements";
import { EXTRA_PUBLIC_KEYS } from "../config";
import { PUBLIC_KEYS, REVOKED_ORDERS } from "./license-keys";

// Copying makes the digest ArrayBuffer-backed, which is the type noble-ed25519 asks for.
ed.hashes.sha512 = (m) => new Uint8Array(sha512(m));

export const LICENSE_PREFIX = "BS1.";

export interface LicensePayload {
  v: 1;
  kid: string;
  ed: "pro";
  oid: string;
  iat: string;
  n?: string;
}

export type LicenseFailure = "empty" | "format" | "version" | "unknown-key" | "signature" | "revoked";

export type LicenseCheck = { ok: true; payload: LicensePayload } | { ok: false; reason: LicenseFailure };

export interface LicenseTrust {
  /** Public keys by key id, as hex. */
  keys: Readonly<Record<string, string>>;
  revoked: readonly string[];
}

export const BUILT_IN_TRUST: LicenseTrust = { keys: { ...PUBLIC_KEYS, ...EXTRA_PUBLIC_KEYS }, revoked: REVOKED_ORDERS };

/** A pasted key or the text of a .bslicense file: whitespace, quotes and line breaks dropped. */
export function normalizeLicense(raw: string): string {
  return raw.replace(/[\s"'“”‘’<>]+/g, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
}

function isPayload(v: unknown): v is LicensePayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.kid === "string" && typeof p.oid === "string" && typeof p.iat === "string" && typeof p.ed === "string" && (p.n === undefined || typeof p.n === "string");
}

export function verifyLicense(raw: string, trust: LicenseTrust = BUILT_IN_TRUST): LicenseCheck {
  const token = normalizeLicense(raw);
  if (!token) return { ok: false, reason: "empty" };
  const parts = token.split(".");
  if (parts.length !== 3 || !/^BS\d+$/.test(parts[0])) return { ok: false, reason: "format" };
  if (parts[0] !== "BS1") return { ok: false, reason: "version" };
  const body = fromBase64Url(parts[1]);
  const sig = fromBase64Url(parts[2]);
  if (!body || !sig || sig.length !== 64) return { ok: false, reason: "format" };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, reason: "format" };
  }
  if (!isPayload(payload)) return { ok: false, reason: "format" };
  if ((payload as { v?: unknown }).v !== 1) return { ok: false, reason: "version" };
  const hex = Object.prototype.hasOwnProperty.call(trust.keys, payload.kid) ? trust.keys[payload.kid] : undefined;
  const pub = hex === undefined ? null : fromHex(hex);
  if (!pub) return { ok: false, reason: "unknown-key" };
  let valid = false;
  try {
    // The signed message is the payload text exactly as it appears in the token.
    valid = ed.verify(sig, new TextEncoder().encode(parts[1]), pub);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature" };
  if (payload.ed !== "pro") return { ok: false, reason: "version" };
  if (trust.revoked.includes(payload.oid)) return { ok: false, reason: "revoked" };
  return { ok: true, payload };
}

export function planFromLicense(raw: string | null | undefined, trust: LicenseTrust = BUILT_IN_TRUST): Plan {
  return raw && verifyLicense(raw, trust).ok ? "pro" : "free";
}

const FAILURE_TEXT: Record<LicenseFailure, string> = {
  empty: "Paste your license key first.",
  format: "That doesn't look like a Book Studio license key. Copy it again from the activation page or your email, all of it.",
  version: "This key is from a newer version of Book Studio. Update the plugin, then paste it again.",
  "unknown-key": "This key was signed with a key this version doesn't know. Update Book Studio and try again.",
  signature: "This key isn't valid. If you copied it, check that nothing was cut off.",
  revoked: "This license has been refunded or withdrawn, so it no longer unlocks Pro.",
};

export function describeFailure(reason: LicenseFailure): string {
  return FAILURE_TEXT[reason];
}

/** A sentence for settings: who the license belongs to and how it stands. */
export function describeLicense(raw: string | null | undefined, trust: LicenseTrust = BUILT_IN_TRUST): string {
  if (!raw) return "No license key. You're on the free plan.";
  const check = verifyLicense(raw, trust);
  if (!check.ok) return `The stored license key doesn't work: ${describeFailure(check.reason)} You're on the free plan.`;
  const { n, oid, iat } = check.payload;
  return `Book Studio Pro is active${n ? ` for ${n}` : ""} (order ${oid}, issued ${iat}). It works offline and never expires.`;
}
