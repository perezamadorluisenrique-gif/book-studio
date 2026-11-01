// The plan the person is on, backed by a stored license key. Shared by both hosts.
// Activate takes either an offline signed key (engine/license-offline.ts, checked
// on the device) or a key from the payment service, which is validated once with
// that service (engine/license-online.ts) and never again.

import { FREE_EDITION, PRO_LICENSE_TEST, PRO_PREVIEW } from "../config";
import type { Plan } from "../engine/entitlements";
import { BUILT_IN_TRUST, describeFailure as describeOffline, describeLicense, LICENSE_PREFIX, normalizeLicense, planFromLicense, verifyLicense, type LicensePayload, type LicenseTrust } from "../engine/license-offline";
import { describeFailure as describeOnline, validateOnline, type OnlineConfig, type Post, type Provider } from "../engine/license-online";
import { ONLINE } from "../engine/pro-config";
import type { StudioHost } from "./host";

const KEY = "license";
const PREVIEW = "previewPro";

export class LicenseError extends Error {}

/** What is stored for a key the payment service accepted. Offline keys stay plain strings. */
export interface OnlineLicense {
  key: string;
  provider: Provider;
  validatedAt: string;
}

function isOnlineLicense(v: unknown): v is OnlineLicense {
  return typeof v === "object" && v !== null && typeof (v as OnlineLicense).key === "string" && (v as OnlineLicense).key !== "" && typeof (v as OnlineLicense).provider === "string";
}

/** The service settings of this build. Only an e2e build points them at a local server. */
export function onlineConfig(): OnlineConfig {
  return PRO_LICENSE_TEST ?? ONLINE;
}

export class LicenseManager {
  private listeners = new Set<() => void>();

  constructor(
    private host: Pick<StudioHost, "store">,
    private config: () => OnlineConfig = onlineConfig,
    private trust: LicenseTrust = BUILT_IN_TRUST,
  ) {}

  private get stored(): string | OnlineLicense | undefined {
    const v = this.host.store.get<unknown>(KEY);
    if (typeof v === "string" && v) return v;
    return isOnlineLicense(v) ? v : undefined;
  }

  /** The stored key. Anything else in that slot, such as a record left by 0.1.x, counts as no key. */
  get key(): string | undefined {
    const v = this.stored;
    return typeof v === "string" ? v : v?.key;
  }

  /** Who the stored key is for, when it verifies. */
  get holder(): LicensePayload | undefined {
    const key = typeof this.stored === "string" ? this.stored : undefined;
    const check = key ? verifyLicense(key, this.trust) : null;
    return check?.ok ? check.payload : undefined;
  }

  /** Whether this build has licensing at all. */
  get configured(): boolean {
    return !FREE_EDITION;
  }

  /** Developer builds can switch Pro on without a key. */
  get previewPro(): boolean {
    return PRO_PREVIEW && this.host.store.get<boolean>(PREVIEW) === true;
  }

  set previewPro(on: boolean) {
    this.host.store.set(PREVIEW, on);
    this.changed();
  }

  plan(): Plan {
    if (FREE_EDITION) return "free";
    if (this.previewPro) return "pro";
    const v = this.stored;
    return typeof v === "object" ? "pro" : planFromLicense(v, this.trust);
  }

  describe(): string {
    const v = this.stored;
    if (typeof v === "object") return `Book Studio Pro is active (key checked with the payment service on ${v.validatedAt.slice(0, 10)}). It never expires.`;
    return describeLicense(v, this.trust);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Keep a pasted key if it is good: an offline signed key (or the text of a
   * .bslicense file) first, otherwise one the payment service accepts. The
   * service is asked once, here, and never again.
   */
  async activate(raw: string, post: Post): Promise<void> {
    const offline = verifyLicense(raw, this.trust);
    if (offline.ok) {
      this.host.store.set(KEY, normalizeLicense(raw));
      this.changed();
      return;
    }
    const cfg = this.config();
    const online = await validateOnline(raw, cfg, post);
    if (online.ok) {
      const record: OnlineLicense = { key: raw.trim(), provider: online.provider, validatedAt: new Date().toISOString() };
      this.host.store.set(KEY, record);
      this.changed();
      return;
    }
    // A signed Book Studio key that fails here is an offline-key problem, not a service one.
    if (raw.trim().startsWith(LICENSE_PREFIX) && online.reason !== "network") throw new LicenseError(describeOffline(offline.reason));
    throw new LicenseError(describeOnline(online.reason));
  }

  remove(): void {
    this.host.store.set(KEY, undefined);
    this.changed();
  }
}
