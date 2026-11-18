// Tests for the offline app files: the manifest is installable (and is not the Obsidian manifest.json) and the
// service worker template is intact. The built worker and the offline behaviour are checked in e2e/web.e2e.ts.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lazyChunks } from "../tools/lazy-chunks.mjs";

const manifest = JSON.parse(readFileSync("src/web/app.webmanifest", "utf8")) as { icons: { src: string; sizes: string; type: string }[]; start_url: string; scope: string; display: string; name: string };

describe("web app manifest", () => {
  it("can be installed: name, standalone, start inside scope, 192 and 512 px icons that exist", () => {
    expect(manifest.name).toBe("Book Studio");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find((i) => i.sizes === size);
      expect(icon?.type).toBe("image/png");
      expect(existsSync(`src/web/${icon?.src}`), size).toBe(true);
    }
  });

  it("is linked from the page as app.webmanifest, never as manifest.json", () => {
    const html = readFileSync("src/web/index.html", "utf8");
    expect(html).toContain('rel="manifest" href="app.webmanifest"');
    expect(html).not.toMatch(/href="[^"]*manifest\.json"/);
  });
});

describe("service worker template", () => {
  it("has the three places the build fills in, once each", () => {
    const sw = readFileSync("src/web/sw.js", "utf8");
    expect(sw.split("__BUILD__")).toHaveLength(2);
    expect(sw.split("__FILES__")).toHaveLength(2);
    expect(sw.split("__LAZY__")).toHaveLength(2);
  });
});

describe("chunks cached on first use", () => {
  // app → hyphen (dynamic, kept offline) and app → mermaid (dynamic, lazy) → flow, elk; both share "shared".
  const metafile = {
    outputs: {
      "dist/web/app.js": { entryPoint: "src/web/main.ts", imports: [{ path: "dist/web/chunks/hyph-1.js" }, { path: "dist/web/chunks/mermaid-1.js" }, { path: "dist/web/chunks/shared-1.js" }] },
      "dist/web/layout-worker.js": { entryPoint: "src/web/layout-worker.ts", imports: [{ path: "dist/web/chunks/shared-1.js" }] },
      "dist/web/chunks/hyph-1.js": { entryPoint: "node_modules/hyphen/patterns/es.js", imports: [] },
      "dist/web/chunks/shared-1.js": { imports: [] },
      "dist/web/chunks/mermaid-1.js": { entryPoint: "node_modules/mermaid/dist/mermaid.core.mjs", imports: [{ path: "dist/web/chunks/flow-1.js" }, { path: "dist/web/chunks/shared-1.js" }] },
      "dist/web/chunks/flow-1.js": { entryPoint: "node_modules/mermaid/dist/chunks/flow.mjs", imports: [{ path: "dist/web/chunks/elk-1.js" }] },
      "dist/web/chunks/elk-1.js": { imports: [] },
      "dist/web/app.css": {},
    },
  };
  const isLazy = (e: string) => e.includes("node_modules/mermaid/");

  it("leaves out of the install only what is reached through Mermaid", () => {
    expect(lazyChunks(metafile, ["src/web/main.ts", "src/web/layout-worker.ts"], isLazy, "dist/web")).toEqual(["chunks/elk-1.js", "chunks/flow-1.js", "chunks/mermaid-1.js"]);
  });

  it("keeps everything when nothing is lazy", () => {
    expect(lazyChunks(metafile, ["src/web/main.ts", "src/web/layout-worker.ts"], () => false, "dist/web/")).toEqual([]);
  });

  it("caches lazy chunks first-use, then serves them from that cache", () => {
    const sw = readFileSync("src/web/sw.js", "utf8");
    expect(sw).toMatch(/if \(LAZY\.includes\(rel\)\)[\s\S]*caches\.open\(LAZY_CACHE\)[\s\S]*c\.match\(req[\s\S]*fetch\(req\)[\s\S]*c\.put\(req/);
    // The cache survives a new build (the activate step only prunes chunks the new build no longer has).
    expect(sw).toMatch(/key !== LAZY_CACHE/);
  });
});
