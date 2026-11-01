# Orientation
- Before exploring, read `.claude/REPO_MAP.md` (files + top-level symbols, regenerated each session) and use the `repo-map` skill; delegate multi-file searches to the Explore subagent.
- Read large files with `offset`/`limit`; use Grep to locate first.

# Compact instructions
When compacting, keep the list of modified files, the test commands run and their results, and open decisions.

# Facts
- Pro keys come from the payment service and are validated once on Activate (`src/engine/license-online.ts`, a byte-identical copy of `obsidian-dev/tools/pro-license/license-online.ts`; settings in the generated `src/engine/pro-config.ts`, rewritten by `apply-config.mjs`, never by hand). `LicenseManager.activate(key, post)` in `src/app/license-manager.ts`; the Obsidian host's `post` uses `requestUrl`, the web's uses `fetch`. Offline `BS1.` Ed25519 keys (`license-offline.ts`, `node tools/license.mjs keygen|sign|verify`) stay as plan B and are inactive while `PUBLIC_KEYS` in `license-keys.ts` is empty. e2e builds set `PRO_LICENSE_TEST_API`; releases never do (`tests/release-build.test.ts`).
- Gates live in `src/engine/entitlements.ts`. Build flags (`esbuild.config.mjs`): `BOOK_STUDIO_EDITION=community` strips Pro, `BOOK_STUDIO_PRO_PREVIEW=1` unlocks it for demos.
- Merging a change to `manifest.json` publishes a release (`release.yml`). Pro stays unreleased: do not bump the version.
- KDP numbers (spine rate, barcode margin, spine text from 79 pages) are unverified against official templates.
