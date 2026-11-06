import { defineConfig } from "vitest/config";

// Browser tests over the built web app (npm run build:web first). Kept apart
// from the unit tests: they need Chromium and take a few seconds each.
export default defineConfig({
  test: { include: ["e2e/**/*.e2e.ts"], testTimeout: 120_000, hookTimeout: 60_000 },
});
