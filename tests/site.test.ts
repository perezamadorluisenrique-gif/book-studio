/// <reference types="node" />
// The guide pages: every page builds, pairs with its translation, links only
// to pages and files that exist, and loads nothing from another host.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { auditPages, buildSite, loadPages, SITE } from "../tools/site.mjs";

const books = ["oz", "leyendas"].map((id) => ({
  id,
  title: id,
  author: "A",
  language: "en",
  trim: '6" × 9"',
  theme: "classic",
  pages: 100,
  files: (["pdf", "epub", "zip"] as const).map((kind) => ({ kind, name: `${id}.${kind}`, bytes: 1000 })),
}));

function htmlFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

describe("guide pages", () => {
  const out = mkdtempSync(join(tmpdir(), "bs-site-"));
  mkdirSync(join(out, "downloads"), { recursive: true });
  writeFileSync(join(out, "downloads", "downloads.json"), JSON.stringify(books));
  for (const b of books) {
    mkdirSync(join(out, "downloads", b.id), { recursive: true });
    for (const f of b.files) writeFileSync(join(out, "downloads", b.id, f.name), "x");
  }
  // The app's own files, which esbuild.config.mjs writes in a real build.
  writeFileSync(join(out, "index.html"), "app");
  mkdirSync(join(out, "fonts"), { recursive: true });
  for (const f of ["AtkinsonHyperlegible-Regular", "AtkinsonHyperlegible-Bold", "AtkinsonHyperlegible-Italic", "CrimsonPro-Bold"]) writeFileSync(join(out, "fonts", `${f}.ttf`), "x");

  const pages = loadPages("site");
  const built = buildSite("site", out);
  const files = htmlFiles(out).filter((f) => f !== join(out, "index.html"));

  it("has 6 guides and a landing page in each language, all passing the audit", () => {
    expect(auditPages(pages)).toEqual([]);
    for (const lang of ["en", "es"]) {
      expect(pages.filter((p) => p.lang === lang && p.type !== "landing")).toHaveLength(6);
      expect(pages.filter((p) => p.lang === lang && p.type === "landing")).toHaveLength(1);
    }
    expect(built.pages).toBe(30); // 14 guides and landing pages, 14 tool pages, 2 tools indexes
    expect(files).toHaveLength(30);
  });

  it("links only to pages and files that exist, and loads nothing from another host", () => {
    for (const file of files) {
      const html = readFileSync(file, "utf8");
      // The only script on the site is the tools' own file, and only the tool pages load it.
      const isTool = /\/(tools|herramientas)\/[^/]+\/index\.html$/.test(file) && !/\/(tools|herramientas)\/index\.html$/.test(file);
      expect(html, file).not.toMatch(isTool ? /<script(?![^>]*(application\/ld\+json|src="(\.\.\/)+tools\/tools\.js"))/ : /<script(?![^>]*application\/ld\+json)/);
      expect(html, file).not.toMatch(/<(img|link|script)[^>]+(src|href)="https?:\/\/(?!perezamadorluisenrique-gif\.github\.io\/book-studio\/)/);
      for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (/^(https?:|mailto:|#)/.test(url)) continue;
        const path = url.split(/[?#]/)[0];
        let target = normalize(join(dirname(file), path));
        if (path === "" || path.endsWith("/")) target = join(target, "index.html");
        expect(relative(out, target).startsWith(".."), `${file}: ${url} leaves the site`).toBe(false);
        expect(existsSync(target), `${relative(out, file)} links to missing ${url}`).toBe(true);
      }
    }
  });

  it("gives every page a canonical URL, both hreflang alternates and a description", () => {
    for (const file of files) {
      const html = readFileSync(file, "utf8");
      expect(html).toMatch(new RegExp(`<link rel="canonical" href="${SITE}`));
      expect(html.match(/hreflang="(en|es|x-default)" href=/g)?.length).toBe(3);
      expect(html).toMatch(/<meta name="description" content="[^"]{70,}"/);
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    }
  });

  it("makes each landing page a one-h1 sales page: main button, comparison table, six questions, no script", () => {
    for (const lang of ["en", "es"]) {
      const file = join(out, lang, "index.html");
      const html = readFileSync(file, "utf8");
      expect(html.match(/<h1[ >]/g), lang).toHaveLength(1);
      expect(html).toMatch(/<a class="btn primary" href="\.\.\/\?start=import">/);
      expect(html).toMatch(/<a class="btn" href="\.\.\/\?sample=/);
      expect(html.match(/<table>/g)?.length).toBe(2); // the comparison and the sample downloads
      expect(html).toContain("Vellum");
      expect(html).toContain("Kindle Create");
      expect(html.match(/<h3>[^<]+\?<\/h3>/g)).toHaveLength(6);
      expect(html).toContain('"@type":"FAQPage"');
      expect(html).toContain('"price":"0"');
      expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
      expect(html.match(/<img /g)?.length).toBe(5);
      // Before the images, the page stays small.
      expect(Buffer.byteLength(html)).toBeLessThan(60_000);
    }
  });

  it("writes a sitemap with every page and a robots.txt that points to it", () => {
    const map = readFileSync(join(out, "sitemap.xml"), "utf8");
    expect(map.match(/<loc>/g)).toHaveLength(31); // the app and 30 pages
    expect(readFileSync(join(out, "robots.txt"), "utf8")).toContain(`Sitemap: ${SITE}sitemap.xml`);
  });
});
