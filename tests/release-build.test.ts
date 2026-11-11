import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRO_INCLUDED } from "../src/edition";

// A release build has no e2e hooks: the test server's address and ids must not be in main.js.
// This runs the real build script (it rewrites the git-ignored main.js and styles.css).
function build(env: Record<string, string>): string {
  execFileSync("node", ["esbuild.config.mjs", "production", "plugin"], { stdio: "pipe", env: { ...process.env, PRO_LICENSE_TEST_API: "", ...env } });
  return readFileSync("main.js", "utf8");
}

describe("release build", () => {
  it("contains no e2e address or ids without PRO_LICENSE_TEST_API", () => {
    const js = build({});
    expect(js).not.toContain("127.0.0.1");
    expect(js).not.toContain("e2e-benefit");
  }, 60_000);

  // Only the Pro overlay has a licence check to point at a test server.
  it.runIf(PRO_INCLUDED)("does carry them when PRO_LICENSE_TEST_API is set (so the check above can fail)", () => {
    const js = build({ PRO_LICENSE_TEST_API: "http://127.0.0.1:8787" });
    expect(js).toContain("127.0.0.1:8787");
    expect(js).toContain("e2e-benefit");
    build({}); // leave a clean main.js behind
  }, 60_000);
});
