# Book Studio web for KDP authors: launch plan

Goal (meta B, 2026-11-01): make the web app the reference free formatter for Amazon KDP authors and the funnel into Book Studio Pro. Everything here must be live and verified so that the only step left is the payment link (Enrique).

Constraints: zero cost, no new accounts or paid services, pseudonym Siulved54 / Hidden Problems Lab only, nothing that is free today becomes Pro, no analytics, no cookies, no third-party requests.

## What ships

| Piece | Where | Done when |
|---|---|---|
| Web app (existing) | `/book-studio/` | Unchanged URL; footer links to the guides in both languages |
| 6 guides × 2 languages | `/book-studio/en/<slug>/`, `/book-studio/es/<slug>/` | Static HTML, readable without JavaScript, `hreflang` pairs, canonical, JSON-LD, sitemap |
| Guide hubs | `/book-studio/en/`, `/book-studio/es/` | List the guides, the samples and the app |
| 2 sample books | `/book-studio/downloads/` | Source folder (zip), print PDF and EPUB, built in CI from `sample/` |
| Pro unlock | the app, from the Pro thread's PR | Same key as the plugin; this work only links to the sale page and tests the unlock |
| X drafts | `/mnt/project-files/book-studio-web/` | 3 posts + screenshots; Enrique posts |

### The six guides

| # | English slug | Spanish slug | Search intent |
|---|---|---|---|
| 1 | `free-kdp-book-formatter` | `formatear-libro-kdp-gratis` | "free KDP formatter", "format book for KDP free" |
| 2 | `accessible-epub` | `epub-accesible` | "accessible EPUB", "EPUB 3 accessibility KDP" (EAA since June 2025) |
| 3 | `kdp-trim-sizes` | `tamanos-kdp` | "KDP trim sizes", "KDP margins", "bleed" |
| 4 | `markdown-to-book` | `markdown-a-libro` | "Markdown to PDF book", "Obsidian to book" |
| 5 | `vellum-atticus-kindle-create` | `vellum-atticus-kindle-create` | "Vellum alternative Windows", "Atticus vs Vellum" |
| 6 | `format-a-book-for-kdp` | `como-formatear-un-libro-para-kdp` | "how to format a book for KDP" step by step |

Content rules: every KDP number comes from KDP's help pages and is linked; rival prices come from their own sites with an as-of date; the comparison says plainly where rivals win (Vellum's design polish, Atticus's editor and cloud sync, Kindle Create's direct KDP upload). No invented testimonials, no download counts we cannot show. Each guide ends with "Open the app" and "Download a sample". Free features first; Pro is mentioned once per page, factually, with what it adds.

### Samples

1. *The Wonderful Wizard of Oz* (English, fiction, 6x9, Classic): already in `sample/oz`.
2. Gustavo Adolfo Bécquer, *Leyendas* (Spanish, 1912 text from Project Gutenberg #53552, public domain everywhere; author died 1870): six legends plus the *Rimas*, 6x9 in the Modern theme (the free trim), so the site shows Spanish hyphenation, verse and a second theme. The 1912 introduction by the Álvarez Quintero brothers is left out (not public domain in the EU).

`tools/build-downloads.ts` renders both with the free plan into `dist/web/downloads/`; `tools/validate-downloads.mjs` checks every PDF against KDP's rules (page box = trim (+ bleed), 24–828 pages, inside margin for the page count, fonts embedded) and runs EPUBCheck on every EPUB. The Pages workflow runs both and refuses to deploy on any error.

## Site build

- Sources: `site/<lang>/<slug>.md` with YAML front matter (`title`, `description`, `pair`, `updated`), rendered with `marked` (already a dependency) by `tools/build-site.mjs` into `dist/web/`.
- One template: skip link, header (app link, language switch), `<main>`, footer (privacy line, GitHub, Obsidian plugin). System font stack; the app's own CSS variables for colour; light and dark.
- Head: `<html lang>`, title ≤ 60 chars, description ≤ 155, canonical, `hreflang` en/es/x-default, Open Graph without images from other hosts, JSON-LD (`SoftwareApplication` on the hubs, `HowTo` on guide 6, `Article` elsewhere), CSP `default-src 'self'` with no scripts on guide pages.
- `sitemap.xml` and `robots.txt` at the site root (`/book-studio/`). Google only reads a robots.txt at the host root, so the sitemap is also linked from every page head; submitting it in Search Console is optional and Enrique's call (it needs a Google account).
- `npm run build:web` builds app, guides and downloads in one go; `npm test` covers the site generator (links resolve, every page has its pair, titles and descriptions within limits, no external scripts).

## Quality bar

- `kit web` with `--axe` at 390 and 1280 px on the app, both hubs and all 12 guides: zero axe violations, zero tap targets under 24 px (fix the three checkboxes: Bleed, Facing pages, Margins), no horizontal overflow.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:web` clean; `kit score`.
- EPUBCheck 5: no errors or warnings on both sample EPUBs. KDP validator: no errors on both PDFs.
- No request to any host but the site itself (Playwright request log on the app and one guide).

## Pro unlock, ready for payment

Owned by the "3 Pro ready to sell" thread, which replaces PR #9: the payment service issues the key, the app checks it once on activation against that service's public API (CORS works in the browser), and the config lives in a generated `src/pro-config.ts`. This work does not touch licensing; it links every guide's Pro line to the sale page, https://perezamadorluisenrique-gif.github.io/pro/book-studio/ (Spanish: `/pro/book-studio/es/`), and re-checks the web unlock with a test key once that PR is merged.

## Order of work

1. Plan (this file).
2. Checkbox tap targets; footer links in the app.
3. Bécquer sample; downloads builder and validator (KDP + EPUBCheck).
4. Site generator with tests, then the 12 pages.
5. Pages workflow: build, validate, deploy.
6. Verification pass; X drafts with screenshots.
7. PR from main; merge when green; after the Pro PR merges, re-test the unlock on the live site.

## Out of scope

Payment provider, Search Console, any account; translating the app UI; new Pro features.
