// The public half of the Ed25519 key that signs Pro licenses, and the licenses
// that no longer count. Both ship inside the plugin, so checking a license
// never needs the network.
//
// To go live: `node tools/license.mjs keygen`, keep the private key offline
// (never in this repo), paste the printed public key below, and release.
// Until a key is listed here no license verifies and everyone stays on free.

/** Public keys by key id, as 64 hex characters (32 raw bytes). Old ids stay so earlier licenses keep working after a rotation. */
export const PUBLIC_KEYS: Readonly<Record<string, string>> = {
  // "2026a": "<64 hex characters from `node tools/license.mjs keygen`>",
};

/**
 * Order ids of refunded or leaked licenses. The list travels with each release
 * of the plugin, which is an ordinary directory update, not a self-update.
 */
export const REVOKED_ORDERS: readonly string[] = [];
