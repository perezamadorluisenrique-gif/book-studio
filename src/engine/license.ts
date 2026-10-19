// Pro license keys, sold through Polar as merchant of record. Polar's customer
// portal endpoints need no secret and are meant for apps like this one, so the
// plugin and the web app call them directly.
//
// These are the only network requests Book Studio makes. They happen when the
// person activates or removes a key, and at startup when the last check is
// older than REVALIDATE_AFTER. Offline, a key checked within OFFLINE_GRACE
// keeps working.

import type { Plan } from "./entitlements";

export const POLAR_API = "https://api.polar.sh/v1/customer-portal/license-keys";

const DAY = 24 * 60 * 60 * 1000;
export const REVALIDATE_AFTER = 3 * DAY;
export const OFFLINE_GRACE = 14 * DAY;

export interface HttpResponse {
  status: number;
  json: unknown;
}

/** POST a JSON body and return the status and parsed body; throws only when the request can't be made. */
export type HttpPost = (url: string, body: unknown) => Promise<HttpResponse>;

export interface LicenseConfig {
  organizationId: string;
  api?: string;
}

export interface LicenseState {
  key: string;
  /** Polar activation id for this device, when the key limits activations. */
  activationId?: string;
  status: "granted" | "invalid";
  /** Time of the last successful answer from Polar, ms since the epoch. */
  validatedAt: number;
  expiresAt?: number;
  /** The masked key Polar shows, e.g. "****-1A2B". */
  displayKey?: string;
  /** Name or email of the customer, shown in settings. */
  customer?: string;
}

export class LicenseError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "rejected" | "limit" | "config",
  ) {
    super(message);
  }
}

interface PolarKey {
  key?: string;
  display_key?: string;
  status?: string;
  expires_at?: string | null;
  limit_activations?: number | null;
  customer?: { name?: string | null; email?: string | null } | null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function stateFrom(key: string, k: PolarKey, now: number, activationId?: string): LicenseState {
  const expires = k.expires_at ? Date.parse(k.expires_at) : NaN;
  return {
    key,
    activationId,
    status: k.status === undefined || k.status === "granted" ? "granted" : "invalid",
    validatedAt: now,
    expiresAt: Number.isFinite(expires) ? expires : undefined,
    displayKey: k.display_key,
    customer: k.customer?.name || k.customer?.email || undefined,
  };
}

async function post(http: HttpPost, cfg: LicenseConfig, path: string, body: Record<string, unknown>): Promise<HttpResponse> {
  if (!cfg.organizationId) throw new LicenseError("Licensing isn't configured in this build.", "config");
  try {
    return await http(`${cfg.api ?? POLAR_API}/${path}`, { ...body, organization_id: cfg.organizationId });
  } catch {
    throw new LicenseError("Couldn't reach the license server. Check your connection and try again.", "network");
  }
}

function rejection(res: HttpResponse): LicenseError {
  if (res.status === 404) return new LicenseError("That license key wasn't found, or it has been revoked or has expired.", "rejected");
  if (res.status === 422) return new LicenseError("That doesn't look like a Book Studio license key.", "rejected");
  if (res.status === 429) return new LicenseError("Too many attempts. Wait a minute and try again.", "network");
  if (res.status >= 500) return new LicenseError("The license server had a problem. Try again later.", "network");
  const detail = obj(res.json).detail;
  return new LicenseError(typeof detail === "string" ? detail : `The license server refused the key (${res.status}).`, "rejected");
}

/**
 * Activate a key on this device. Keys without an activation limit can't be
 * activated, so they are validated instead.
 */
export async function activateLicense(http: HttpPost, cfg: LicenseConfig, rawKey: string, label: string, now = Date.now()): Promise<LicenseState> {
  const key = rawKey.trim();
  if (!key) throw new LicenseError("Enter a license key.", "rejected");
  const res = await post(http, cfg, "activate", { key, label });
  if (res.status === 200) {
    const body = obj(res.json);
    const state = stateFrom(key, obj(body.license_key), now, typeof body.id === "string" ? body.id : undefined);
    if (state.status !== "granted") throw new LicenseError("This license key is no longer active.", "rejected");
    return state;
  }
  if (res.status !== 403) throw rejection(res);
  // 403: revoked or expired, out of activations, or a key without activations.
  const check = await post(http, cfg, "validate", { key });
  if (check.status !== 200) throw rejection(check);
  const k = obj(check.json) as PolarKey;
  if (typeof k.limit_activations === "number") {
    throw new LicenseError(`This key is already active on ${k.limit_activations} device${k.limit_activations === 1 ? "" : "s"}, its limit. Remove it from another device first, then try again.`, "limit");
  }
  const state = stateFrom(key, k, now);
  if (state.status !== "granted") throw new LicenseError("This license key is no longer active.", "rejected");
  return state;
}

/**
 * Check a stored key again. Returns the updated state; a key Polar no longer
 * recognizes comes back "invalid". Network failures throw, leaving the stored
 * state (and its offline grace) as it was.
 */
export async function validateLicense(http: HttpPost, cfg: LicenseConfig, state: LicenseState, now = Date.now()): Promise<LicenseState> {
  const body: Record<string, unknown> = { key: state.key };
  if (state.activationId) body.activation_id = state.activationId;
  const res = await post(http, cfg, "validate", body);
  if (res.status === 200) return stateFrom(state.key, obj(res.json), now, state.activationId);
  if (res.status === 404) return { ...state, status: "invalid", validatedAt: now };
  throw rejection(res);
}

/** Free this device's activation so the key can be used elsewhere. */
export async function deactivateLicense(http: HttpPost, cfg: LicenseConfig, state: LicenseState): Promise<void> {
  if (!state.activationId) return;
  const res = await post(http, cfg, "deactivate", { key: state.key, activation_id: state.activationId });
  // 404: the activation is already gone, which is what we wanted.
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw rejection(res);
}

export function planFromLicense(state: LicenseState | null | undefined, now = Date.now()): Plan {
  if (!state || state.status !== "granted") return "free";
  if (state.expiresAt !== undefined && state.expiresAt <= now) return "free";
  if (now - state.validatedAt > OFFLINE_GRACE) return "free";
  return "pro";
}

export function needsRevalidation(state: LicenseState | null | undefined, now = Date.now()): boolean {
  return !!state && state.status === "granted" && now - state.validatedAt > REVALIDATE_AFTER;
}

/** A sentence for settings: who the key belongs to and how it stands. */
export function describeLicense(state: LicenseState | null | undefined, now = Date.now()): string {
  if (!state) return "No license key. You're on the free plan.";
  const who = state.customer ? ` for ${state.customer}` : "";
  const key = state.displayKey ?? `…${state.key.slice(-4)}`;
  if (state.status !== "granted") return `Key ${key} is no longer active. You're on the free plan.`;
  if (state.expiresAt !== undefined && state.expiresAt <= now) return `Key ${key} expired on ${new Date(state.expiresAt).toISOString().slice(0, 10)}.`;
  if (now - state.validatedAt > OFFLINE_GRACE) return `Key ${key}${who} hasn't been checked for a while. Connect to the internet to keep Pro.`;
  const until = state.expiresAt !== undefined ? `, renews or ends ${new Date(state.expiresAt).toISOString().slice(0, 10)}` : "";
  return `Book Studio Pro is active${who} (key ${key}${until}).`;
}
