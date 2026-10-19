// The plan the person is on, backed by a stored license key. Shared by both hosts.

import { FREE_EDITION, POLAR_ORGANIZATION_ID, PRO_PREVIEW } from "../config";
import type { Plan } from "../engine/entitlements";
import { activateLicense, deactivateLicense, LicenseError, needsRevalidation, planFromLicense, validateLicense, type LicenseConfig, type LicenseState } from "../engine/license";
import type { StudioHost } from "./host";

const KEY = "license";
const PREVIEW = "previewPro";

export class LicenseManager {
  private listeners = new Set<() => void>();
  readonly config: LicenseConfig = { organizationId: POLAR_ORGANIZATION_ID };

  constructor(private host: Pick<StudioHost, "http" | "store" | "activationLabel">) {}

  get state(): LicenseState | undefined {
    return this.host.store.get<LicenseState>(KEY);
  }

  get configured(): boolean {
    return !FREE_EDITION && !!this.config.organizationId;
  }

  /** Prototype builds can switch Pro on without a key. */
  get previewPro(): boolean {
    return PRO_PREVIEW && this.host.store.get<boolean>(PREVIEW) === true;
  }

  set previewPro(on: boolean) {
    this.host.store.set(PREVIEW, on);
    this.changed();
  }

  plan(now = Date.now()): Plan {
    if (FREE_EDITION) return "free";
    return this.previewPro ? "pro" : planFromLicense(this.state, now);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private store(state: LicenseState | undefined): void {
    this.host.store.set(KEY, state);
    this.changed();
  }

  async activate(key: string): Promise<LicenseState> {
    const state = await activateLicense(this.host.http, this.config, key, this.host.activationLabel);
    this.store(state);
    return state;
  }

  /** Remove the key from this device. Resolves to a note if the server couldn't be told. */
  async remove(): Promise<string | null> {
    const state = this.state;
    if (!state) return null;
    let note: string | null = null;
    try {
      await deactivateLicense(this.host.http, this.config, state);
    } catch (e) {
      note = e instanceof LicenseError && e.kind === "network" ? "The key was removed here, but the license server couldn't be reached, so this device may still count toward its limit." : null;
    }
    this.store(undefined);
    return note;
  }

  /** Check the key again if the last check is old. Failures leave the stored state alone. */
  async refreshIfDue(): Promise<void> {
    const state = this.state;
    if (!this.configured || !state || !needsRevalidation(state)) return;
    try {
      this.store(await validateLicense(this.host.http, this.config, state));
    } catch {
      // Offline or the server is down: the offline grace period covers it.
    }
  }
}
