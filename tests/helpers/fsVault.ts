/// <reference types="node" />
// A VaultSource over a directory on disk, for tests and the render script.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { VaultSource } from "../../src/engine/book";
import { createResolver } from "../../src/engine/resolve";

function walk(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push(relative(root, p).split(sep).join("/"));
  }
}

export function fsVault(root: string): VaultSource & { paths: string[] } {
  const paths: string[] = [];
  walk(root, root, paths);
  const resolve = createResolver(paths);
  return {
    paths,
    read: async (p) => readFileSync(join(root, p), "utf8"),
    readBinary: async (p) => new Uint8Array(readFileSync(join(root, p))),
    resolve,
  };
}
