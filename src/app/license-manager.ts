// The free edition is always on the free plan and has no licence key. The Pro
// overlay replaces this file with the real licence manager; the shape stays the
// same so both hosts compile against either.

import type { Plan } from "../engine/entitlements";
import type { Post } from "../engine/license-online";
import type { StudioHost } from "./host";

export class LicenseError extends Error {}

export class LicenseManager {
  constructor(private host: Pick<StudioHost, "store">) {}

  get key(): string | undefined {
    return undefined;
  }

  /** Whether this build has licensing at all. */
  get configured(): boolean {
    return false;
  }

  get previewPro(): boolean {
    return false;
  }

  set previewPro(_on: boolean) {}

  plan(): Plan {
    return "free";
  }

  describe(): string {
    return "";
  }

  onChange(_fn: () => void): () => void {
    return () => undefined;
  }

  activate(_raw: string, _post: Post): Promise<void> {
    return Promise.reject(new LicenseError("This edition of Book Studio has no Pro plan."));
  }

  remove(): void {
    void this.host;
  }
}
