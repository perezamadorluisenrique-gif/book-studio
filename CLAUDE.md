# Orientation
- Before exploring, read `.claude/REPO_MAP.md` (files + top-level symbols, regenerated each session) and use the `repo-map` skill; delegate multi-file searches to the Explore subagent.
- Read large files with `offset`/`limit`; use Grep to locate first.

# Compact instructions
When compacting, keep the list of modified files, the test commands run and their results, and open decisions.

# Facts
- Pro is offline: `BS1.<payload>.<sig>` Ed25519 tokens verified in `src/engine/license-offline.ts`; issue with `node tools/license.mjs keygen|sign|verify`. `PUBLIC_KEYS` in `src/engine/license-keys.ts` is empty until Enrique pastes the real public key; keep the private key outside the repo.
- Gates live in `src/engine/entitlements.ts`. Build flags (`esbuild.config.mjs`): `BOOK_STUDIO_EDITION=community` strips Pro, `BOOK_STUDIO_PRO_PREVIEW=1` unlocks it for demos.
- Merging a change to `manifest.json` publishes a release (`release.yml`). Pro stays unreleased: do not bump the version.
- KDP numbers (spine rate, barcode margin, spine text from 79 pages) are unverified against official templates.
