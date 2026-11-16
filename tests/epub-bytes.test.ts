import { createHash } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { writeEpub } from "../src/engine/epub";
import type { FontSet } from "../src/engine/fonts";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";

// The EPUB a reader downloads must not change when the code that builds it is reorganised. These are the files of the
// two sample books (their order, the hash of each one's content) and the size of the whole zip, with a fixed date.
// The zip's own folder entries carry the time it was made, so the file as a whole is not hashed. A change on purpose
// regenerates this with `-u` and says so in the PR.
let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

describe("EPUB bytes", { timeout: 60_000 }, () => {
  it("keeps the sample EPUBs byte for byte", async () => {
    const lines: string[] = [];
    for (const [name, dir, manifest] of [
      ["oz", "../sample/oz", "The Wonderful Wizard of Oz.md"],
      ["leyendas", "../sample/leyendas", "Leyendas y rimas.md"],
    ] as const) {
      const book = await loadBook(fsVault(new URL(dir, import.meta.url).pathname), manifest, {});
      const data = await writeEpub(book, { accessiblePack: false, fonts, modified: new Date("2026-01-01T00:00:00Z") });
      const zip = await JSZip.loadAsync(data);
      lines.push(`${name} ${data.length} bytes`);
      for (const [path, file] of Object.entries(zip.files)) {
        if (file.dir) continue;
        lines.push(`  ${path} ${createHash("sha256").update(await file.async("uint8array")).digest("hex").slice(0, 16)}`);
      }
    }
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot("./golden/epub-hashes.txt");
  });
});
