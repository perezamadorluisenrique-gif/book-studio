// The plan the person is on, backed by a stored license key. Shared by both hosts.
// A key is checked on the device (engine/license-offline.ts); nothing here
// touches the network.

import { FREE_EDITION, PRO_PREVIEW } from "../config";
import type { Plan } from "../engine/entitlements";
import { describeFailure, describeLicense, normalizeLicense, planFromLicense, verifyLicense, type LicensePayload } from "../engine/license-offline";
import type { StudioHost } from "./host";

const KEY = "license";
const PREVIEW = "previewPro";

export class LicenseError extends Error {}

export class LicenseManager {
  private listeners = new Set<() => void>();

  constructor(private host: Pick<StudioHost, "store">) {}

  /** The stored key. Anything else in that slot, such as a record left by 0.1.x, counts as no key. */
  get key(): string | undefined {
    const v = this.host.store.get<unknown>(KEY);
    return typeof v === "string" && v ? v : undefined;
  }

  /** Who the stored key is for, when it verifies. */
  get holder(): LicensePayload | undefined {
    const key = this.key;
    const check = key ? verifyLicense(key) : null;
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
    return this.previewPro ? "pro" : planFromLicense(this.key);
  }

  describe(): string {
    return describeLicense(this.key);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Check a pasted key or the text of a .bslicense file and keep it if it is good. */
  activate(raw: string): LicensePayload {
    const check = verifyLicense(raw);
    if (!check.ok) throw new LicenseError(describeFailure(check.reason));
    this.host.store.set(KEY, normalizeLicense(raw));
    this.changed();
    return check.payload;
  }

  remove(): void {
    this.host.store.set(KEY, undefined);
    this.changed();
  }
}
