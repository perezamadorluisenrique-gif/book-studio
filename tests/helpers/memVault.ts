// A VaultSource over an in-memory map of notes, for small test books.

import type { VaultSource } from "../../src/engine/book";
import { createResolver } from "../../src/engine/resolve";

export function memVault(files: Record<string, string | Uint8Array>): VaultSource {
  const resolve = createResolver(Object.keys(files));
  const get = (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`No such file: ${p}`);
    return v;
  };
  return {
    read: async (p) => {
      const v = get(p);
      return typeof v === "string" ? v : new TextDecoder().decode(v);
    },
    readBinary: async (p) => {
      const v = get(p);
      return typeof v === "string" ? new TextEncoder().encode(v) : v;
    },
    resolve,
  };
}
