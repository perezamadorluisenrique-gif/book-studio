#!/usr/bin/env node
// Issue and check Book Studio Pro licenses. Runs on the maintainer's machine only;
// the plugin itself just verifies (src/engine/license-offline.ts).
//
//   node tools/license.mjs keygen [--out <private-key.pem>]
//   node tools/license.mjs sign --key <private-key.pem> --kid 2026a --oid <order id> [--name "Ada L."] [--iat 2026-11-20]
//   node tools/license.mjs verify <token> [--pub <64 hex>] [--kid 2026a]
//
// The private key is the only secret in the whole system. Keep it outside this
// repository (a password manager or an offline drive); keygen refuses to write
// it inside a git checkout unless you pass --allow-in-repo.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args.shift();

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const publicHex = (key) => Buffer.from(createPublicKey(key).export({ format: "jwk" }).x, "base64url").toString("hex");

function insideGitCheckout(path) {
  for (let dir = dirname(resolve(path)); ; dir = dirname(dir)) {
    if (existsSync(`${dir}/.git`)) return true;
    if (dirname(dir) === dir) return false;
  }
}

if (cmd === "keygen") {
  const out = flag("out", "book-studio-license.key.pem");
  if (existsSync(out)) fail(`${out} already exists; refusing to overwrite a private key.`);
  if (insideGitCheckout(out) && !args.includes("--allow-in-repo")) fail(`${resolve(out)} is inside a git checkout. Choose a path outside it, e.g. --out ~/secrets/book-studio.key.pem`);
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log(`Private key written to ${resolve(out)} (mode 600). Back it up offline; losing it means no new licenses, leaking it means anyone can mint them.`);
  console.log("\nPublic key for src/engine/license-keys.ts (PUBLIC_KEYS):\n");
  console.log(`  "2026a": "${publicHex(privateKey)}",`);
} else if (cmd === "sign") {
  const keyPath = flag("key");
  const kid = flag("kid");
  const oid = flag("oid");
  if (!keyPath || !kid || !oid) fail("sign needs --key, --kid and --oid.");
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const payload = { v: 1, kid, ed: "pro", oid, iat: flag("iat", new Date().toISOString().slice(0, 10)) };
  const name = flag("name");
  if (name) payload.n = name;
  const body = b64u(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(body), privateKey);
  console.log(`BS1.${body}.${b64u(sig)}`);
} else if (cmd === "verify") {
  const token = (args.shift() ?? "").replace(/\s+/g, "");
  const pub = flag("pub");
  if (!pub) fail("verify needs --pub <64 hex> (the public key from license-keys.ts).");
  const [prefix, body, sig] = token.split(".");
  if (prefix !== "BS1" || !body || !sig) fail("Not a BS1 token.");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pub, "hex").toString("base64url") }, format: "jwk" });
  const ok = verify(null, Buffer.from(body), key, Buffer.from(sig, "base64url"));
  console.log(ok ? `valid: ${Buffer.from(body, "base64url").toString()}` : "INVALID signature");
  process.exit(ok ? 0 : 1);
} else {
  console.log("Usage: node tools/license.mjs keygen | sign | verify (see the header of this file)");
  process.exit(cmd ? 1 : 0);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
