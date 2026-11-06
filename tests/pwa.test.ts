// Tests for the offline app files: the manifest is installable (and is not the Obsidian manifest.json) and the
// service worker template is intact. The built worker and the offline behaviour are checked in e2e/web.e2e.ts.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  it("has the two places the build fills in, once each", () => {
    const sw = readFileSync("src/web/sw.js", "utf8");
    expect(sw.split("__BUILD__")).toHaveLength(2);
    expect(sw.split("__FILES__")).toHaveLength(2);
  });
});
