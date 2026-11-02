// The static guide pages around the web app: Markdown in site/<lang>/, HTML
// out in dist/web/<lang>/. No JavaScript on these pages, no requests to any
// other host, no analytics. `node tools/site.mjs` builds them after
// `esbuild.config.mjs` has built the app; the tests import the pure parts.
//
// Links inside the Markdown use short schemes the generator resolves:
//   app:                 the web app            app:?sample=leyendas
//   guide:<slug>         a guide in the same language
//   download:<book>/<kind>   kind = pdf | epub | zip, from downloads.json
//   pro:                 the Book Studio Pro page in the same language
//   hub:                 the guides index in the same language
// and two placeholders on lines of their own: {{guides}} and {{downloads}}.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";

export const SITE = "https://perezamadorluisenrique-gif.github.io/book-studio/";
export const PRO_PAGE = { en: "https://perezamadorluisenrique-gif.github.io/pro/book-studio/", es: "https://perezamadorluisenrique-gif.github.io/pro/book-studio/es/" };
export const LANGS = ["en", "es"];
const REPO = "https://github.com/perezamadorluisenrique-gif/book-studio";
const PLUGIN = "https://obsidian.md/plugins?id=book-studio";

const UI = {
  en: {
    skip: "Skip to content",
    app: "Open the app",
    guides: "Guides",
    switchTo: "Español",
    switchLabel: "Leer en español",
    privacy: "No accounts, no cookies, no analytics. Your manuscript never leaves your device.",
    source: "Source code",
    plugin: "Obsidian plugin",
    updated: "Updated",
    nav: "Site",
    kinds: { pdf: "Print PDF", epub: "EPUB", zip: "Markdown source" },
    downloadsHead: ["Book", "Pages", "Trim", "Files"],
    pages: "pages",
  },
  es: {
    skip: "Ir al contenido",
    app: "Abrir la app",
    guides: "Guías",
    switchTo: "English",
    switchLabel: "Read in English",
    privacy: "Sin cuentas, sin cookies, sin analítica. Tu manuscrito nunca sale de tu dispositivo.",
    source: "Código fuente",
    plugin: "Plugin de Obsidian",
    updated: "Actualizado",
    nav: "Sitio",
    kinds: { pdf: "PDF de imprenta", epub: "EPUB", zip: "Fuente en Markdown" },
    downloadsHead: ["Libro", "Páginas", "Formato", "Archivos"],
    pages: "páginas",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Split YAML front matter from a Markdown file. */
export function readSource(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: no front matter`);
  const meta = parseYaml(m[1]);
  for (const k of ["title", "description", "slug", "pair", "updated", "type"]) if (meta[k] === undefined) throw new Error(`${file}: front matter needs ${k}`);
  return { ...meta, updated: String(meta.updated), body: m[2] };
}

/** Load every page of every language from a site folder. */
export function loadPages(dir) {
  const pages = [];
  for (const lang of LANGS) {
    for (const name of readdirSync(join(dir, lang)).sort()) {
      if (!name.endsWith(".md")) continue;
      const page = readSource(readFileSync(join(dir, lang, name), "utf8"), `${lang}/${name}`);
      pages.push({ ...page, lang, file: `${lang}/${name}` });
    }
  }
  return pages;
}

/** Path of a page from the site root, with a trailing slash; the hub is "<lang>/". */
export function pagePath(page) {
  return page.slug === "" ? `${page.lang}/` : `${page.lang}/${page.slug}/`;
}

/** Relative prefix from a page back to the site root. */
function up(page) {
  return "../".repeat(pagePath(page).split("/").filter(Boolean).length);
}

function resolveHref(href, page, ctx) {
  const root = up(page);
  if (href.startsWith("app:")) return `${root}${href.slice(4)}`;
  if (href === "hub:") return `${root}${page.lang}/`;
  if (href === "pro:") return PRO_PAGE[page.lang];
  if (href.startsWith("guide:")) {
    const [slug, hash] = href.slice(6).split("#");
    const target = ctx.pages.find((p) => p.lang === page.lang && p.slug === slug);
    if (!target) throw new Error(`${page.file}: no ${page.lang} guide "${slug}"`);
    return `${root}${pagePath(target)}${hash ? `#${hash}` : ""}`;
  }
  if (href.startsWith("download:")) {
    const [book, kind] = href.slice(9).split("/");
    const file = ctx.downloads.find((d) => d.id === book)?.files.find((f) => f.kind === kind);
    if (!file) throw new Error(`${page.file}: no download ${book}/${kind}`);
    return `${root}downloads/${book}/${file.name}`;
  }
  return href;
}

function formatBytes(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

function guidesList(page, ctx) {
  const items = ctx.pages
    .filter((p) => p.lang === page.lang && p.type !== "hub")
    .sort((a, b) => a.order - b.order)
    .map((p) => `<li><a href="${up(page)}${pagePath(p)}">${esc(p.title)}</a><br><span class="muted">${esc(p.description)}</span></li>`);
  return `<ul class="guide-list">\n${items.join("\n")}\n</ul>`;
}

function downloadsTable(page, ctx) {
  const ui = UI[page.lang];
  const rows = ctx.downloads.map((d) => {
    const files = d.files.map((f) => `<a href="${up(page)}downloads/${d.id}/${esc(f.name)}" download>${ui.kinds[f.kind]}</a> <span class="muted">(${formatBytes(f.bytes)})</span>`).join("<br>");
    return `<tr><th scope="row"><cite>${esc(d.title)}</cite><br><span class="muted">${esc(d.author)}</span></th><td>${d.pages}</td><td>${esc(d.trim)}</td><td>${files}</td></tr>`;
  });
  const head = ui.downloadsHead.map((h) => `<th scope="col">${h}</th>`).join("");
  return `<div class="table-wrap" role="region" aria-label="${esc(ui.downloadsHead[0])}" tabindex="0"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows.join("\n")}\n</tbody></table></div>`;
}

/** Markdown body to HTML, with the site's link schemes and placeholders resolved. */
export function renderBody(page, ctx) {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      link({ href, title, tokens }) {
        const url = resolveHref(href, page, ctx);
        const text = this.parser.parseInline(tokens);
        const external = /^https?:/.test(url) && !url.startsWith(SITE);
        return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${text}</a>`;
      },
      image({ href, text }) {
        return `<img src="${esc(resolveHref(href, page, ctx).replace(/^img\//, `${up(page)}img/`))}" alt="${esc(text)}" loading="lazy">`;
      },
      // A wide code block scrolls sideways, so it takes keyboard focus (axe: scrollable-region-focusable).
      code({ text, lang }) {
        const cls = lang ? ` class="language-${esc(lang)}"` : "";
        return `<pre tabindex="0"><code${cls}>${esc(text)}</code></pre>\n`;
      },
      table(token) {
        const head = token.header.map((c) => `<th scope="col">${this.parser.parseInline(c.tokens)}</th>`).join("");
        const body = token.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${this.parser.parseInline(c.tokens)}</th>` : `<td>${this.parser.parseInline(c.tokens)}</td>`)).join("")}</tr>`).join("\n");
        return `<div class="table-wrap" role="region" aria-label="${esc(token.header[0]?.text ?? "Table")}" tabindex="0"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody></table></div>\n`;
      },
    },
  });
  let html = marked.parse(page.body);
  html = html.replace(/<p>\{\{guides\}\}<\/p>/g, () => guidesList(page, ctx));
  html = html.replace(/<p>\{\{downloads\}\}<\/p>/g, () => downloadsTable(page, ctx));
  if (/\{\{\w+\}\}/.test(html)) throw new Error(`${page.file}: unknown placeholder`);
  // The page title is the h1 in the template; headings in the body start at h2.
  if (/<h1[\s>]/.test(html)) throw new Error(`${page.file}: use ## headings; the title is the h1`);
  return html;
}

function jsonLd(page) {
  const url = SITE + pagePath(page);
  const app = {
    "@type": "SoftwareApplication",
    name: "Book Studio",
    applicationCategory: "DesignApplication",
    operatingSystem: "Web browser, Windows, macOS, Linux, Android, iOS",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    url: SITE,
  };
  if (page.type === "hub") return { "@context": "https://schema.org", ...app, inLanguage: page.lang, description: page.description };
  const article = { "@context": "https://schema.org", "@type": "Article", headline: page.title, description: page.description, inLanguage: page.lang, dateModified: page.updated, url, author: { "@type": "Organization", name: "Hidden Problems Lab" }, about: app };
  if (page.type !== "howto" || !page.steps) return article;
  return { ...article, "@type": "HowTo", name: page.title, step: page.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s })) };
}

/** A whole HTML document for one page. */
export function renderPage(page, ctx) {
  const ui = UI[page.lang];
  const root = up(page);
  const pair = ctx.pages.find((p) => p.lang !== page.lang && p.slug === page.pair);
  if (!pair) throw new Error(`${page.file}: pair "${page.pair}" not found`);
  const alt = (p) => `<link rel="alternate" hreflang="${p.lang}" href="${SITE}${pagePath(p)}">`;
  const en = page.lang === "en" ? page : pair;
  const body = renderBody(page, ctx);
  const updated = page.type === "hub" ? "" : `<p class="updated">${ui.updated} <time datetime="${esc(page.updated)}">${esc(page.updated)}</time></p>`;
  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
<title>${esc(page.title)}${page.type === "hub" ? "" : " · Book Studio"}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${SITE}${pagePath(page)}">
${alt(page)}
${alt(pair)}
<link rel="alternate" hreflang="x-default" href="${SITE}${pagePath(en)}">
<link rel="sitemap" type="application/xml" href="${root}sitemap.xml">
<meta property="og:type" content="${page.type === "hub" ? "website" : "article"}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${SITE}${pagePath(page)}">
<meta property="og:image" content="${SITE}img/og.png">
<meta property="og:locale" content="${page.lang === "en" ? "en_US" : "es_ES"}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${root}site.css">
<script type="application/ld+json">${JSON.stringify(jsonLd(page)).replace(/</g, "\\u003c")}</script>
</head>
<body>
<a class="skip" href="#main">${ui.skip}</a>
<header class="site-header">
<nav aria-label="${ui.nav}">
<a class="brand" href="${root}${page.lang}/">Book Studio</a>
<a href="${root}${page.lang}/">${ui.guides}</a>
<a href="${root}${pagePath(pair)}" hreflang="${pair.lang}" lang="${pair.lang}" aria-label="${ui.switchLabel}">${ui.switchTo}</a>
<a class="cta" href="${root}${page.lang === "es" ? "?sample=leyendas" : ""}">${ui.app}</a>
</nav>
</header>
<main id="main">
<article>
<h1>${esc(page.h1 ?? page.title)}</h1>
${updated}
${body}
</article>
</main>
<footer class="site-footer">
<p>${ui.privacy}</p>
<p><a href="${root}">${ui.app}</a> · <a href="${PLUGIN}" rel="noopener">${ui.plugin}</a> · <a href="${REPO}" rel="noopener">${ui.source}</a> · MIT · Siulved54</p>
</footer>
</body>
</html>
`;
}

/** Checks that keep the pages findable and honest; returns problems, empty when fine. */
export function auditPages(pages) {
  const problems = [];
  for (const p of pages) {
    const where = p.file;
    if (p.title.length > 65) problems.push(`${where}: title is ${p.title.length} characters (keep it under 65)`);
    if (p.description.length < 70 || p.description.length > 160) problems.push(`${where}: description is ${p.description.length} characters (70–160)`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.updated)) problems.push(`${where}: updated must be YYYY-MM-DD`);
    if (!pages.some((q) => q.lang !== p.lang && q.slug === p.pair && q.pair === p.slug)) problems.push(`${where}: no matching ${p.lang === "en" ? "es" : "en"} page that pairs back`);
    if (!["hub", "article", "howto"].includes(p.type)) problems.push(`${where}: unknown type ${p.type}`);
    if (p.type === "howto" && !Array.isArray(p.steps)) problems.push(`${where}: a howto lists its steps`);
    if (p.type !== "hub" && !/\]\(app:/.test(p.body)) problems.push(`${where}: no link to the app`);
  }
  const seen = new Set();
  for (const p of pages) {
    const key = pagePath(p);
    if (seen.has(key)) problems.push(`${p.file}: path ${key} is taken`);
    seen.add(key);
  }
  return problems;
}

function sitemap(pages) {
  const urls = pages.map((p) => {
    const pair = pages.find((q) => q.lang !== p.lang && q.slug === p.pair);
    const alts = [p, pair].map((q) => `<xhtml:link rel="alternate" hreflang="${q.lang}" href="${SITE}${pagePath(q)}"/>`).join("");
    return `<url><loc>${SITE}${pagePath(p)}</loc><lastmod>${p.updated}</lastmod>${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${SITE}</loc></url>
${urls.join("\n")}
</urlset>
`;
}

/** Build every page into `out` (normally dist/web). */
export function buildSite(siteDir, out) {
  const pages = loadPages(siteDir);
  const problems = auditPages(pages);
  if (problems.length) throw new Error(`Site pages have problems:\n${problems.join("\n")}`);
  const dl = join(out, "downloads", "downloads.json");
  if (!existsSync(dl)) throw new Error(`${dl} is missing: run \`npm run downloads\` first`);
  const downloads = JSON.parse(readFileSync(dl, "utf8"));
  const ctx = { pages, downloads };
  for (const page of pages) {
    const file = join(out, pagePath(page), "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderPage(page, ctx));
  }
  cpSync(join(siteDir, "site.css"), join(out, "site.css"));
  cpSync(join(siteDir, "img"), join(out, "img"), { recursive: true });
  writeFileSync(join(out, "sitemap.xml"), sitemap(pages));
  writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
  return { pages: pages.length, downloads: downloads.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = buildSite("site", process.argv[2] ?? "dist/web");
  process.stdout.write(`Site: ${r.pages} pages, ${r.downloads} sample books.\n`);
}
