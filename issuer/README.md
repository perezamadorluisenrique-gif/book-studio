# Book Studio Pro issuer

The one piece of Book Studio that uses the network, and it is not in the plugin or the web app. After a buyer pays on Polar, the activation page (`src/web/activate/`) asks this Cloudflare Worker for the key that belongs to their checkout. The Worker asks Polar whether that checkout succeeded for the Pro product, signs a license with the private key and returns it.

- **Stateless.** The key is a function of the checkout (id, day, buyer name) and Ed25519 is deterministic, so the same checkout always gives the same key. A lost key is recovered by asking again with the checkout ID; there is no database.
- **Nothing is logged or stored.** The Worker holds two secrets and nothing else.
- **Only the activation page may call it** (`ALLOWED_ORIGIN`); anything else gets 403.
- **Revoking.** Add a refunded checkout ID to `REVOKED_CHECKOUTS` here (no new key) and to `REVOKED_ORDERS` in `src/engine/license-keys.ts` (the plugin refuses it from the next release on).

## Set up (Enrique, once; nothing here is deployed yet)

1. Keys: `node tools/license.mjs keygen --out <a folder outside the repo>`, back it up offline, and paste the printed public key into `PUBLIC_KEYS` in `src/engine/license-keys.ts`.
2. Polar: create the Pro product. Set its success URL to `https://perezamadorluisenrique-gif.github.io/book-studio/activate/?checkout_id={CHECKOUT_ID}`. Create an organization access token that can read checkouts.
3. Worker, from this folder: put the product id in `wrangler.toml` (`POLAR_PRODUCT_ID`), then
   `npx wrangler secret put LICENSE_PRIVATE_KEY` (paste the PEM), `npx wrangler secret put POLAR_ACCESS_TOKEN`, `npx wrangler deploy`.
4. Builds that know the addresses (the web app's Pages build and the release build):
   `BOOK_STUDIO_ISSUER_URL=https://book-studio-issuer.<account>.workers.dev`, `BOOK_STUDIO_ACTIVATE_URL=https://perezamadorluisenrique-gif.github.io/book-studio/activate/`, `BOOK_STUDIO_CHECKOUT_URL=<the Polar checkout link>`.
5. Try it first with Polar's sandbox: `POLAR_API=https://sandbox-api.polar.sh`.

## Check

`npx vitest run tests/issuer.test.ts` signs with a throwaway key and verifies the result with the plugin's own `verifyLicense`.

Not verified against the live Polar API: the code reads `status`, `product_id`, `customer_name` and `created_at` from `GET /v1/checkouts/{id}` as Polar's reference describes them. Run one sandbox purchase before relying on it.
