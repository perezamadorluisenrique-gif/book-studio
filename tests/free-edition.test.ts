import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRO_INCLUDED } from "../src/edition";
import { PRO_COVER_TEMPLATES } from "../src/engine/cover/templates-pro";
import { PRO_THEMES } from "../src/engine/themes-pro";

// This public repository is the free edition: the Pro code lives in a private overlay.
// If any of these fail here, Pro code has been copied back into the public repo.
describe.runIf(!PRO_INCLUDED)("the free edition holds no Pro code", () => {
  it("ships no Pro themes or cover templates", () => {
    expect(PRO_THEMES).toEqual([]);
    expect(PRO_COVER_TEMPLATES).toEqual([]);
  });

  it("ships no licence code", () => {
    for (const f of ["src/engine/license-offline.ts", "src/engine/license-keys.ts", "tools/license.mjs"]) expect(existsSync(f), f).toBe(false);
  });
});
