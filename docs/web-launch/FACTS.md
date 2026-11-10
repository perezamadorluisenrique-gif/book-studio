# Facts the guides may state (checked 2026-11-02)

Every number on the guide pages comes from this file. When a fact changes, change it here and in the pages that use it (`grep -rn` the number in `site/`).

## Amazon KDP paperback rules

Source: KDP Help, "Set trim size, bleed, and margins", https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6 (fetched 2026-11-02).

- Standard paperback trims (inches): 5 × 8; 5.06 × 7.81; 5.25 × 8; 5.5 × 8.5; 6 × 9; 6.14 × 9.21; 6.69 × 9.61; 7 × 10; 7.44 × 9.69; 7.5 × 9.25; 8 × 10; 8.25 × 6; 8.25 × 8.25; 8.5 × 8.5; 8.5 × 11; 8.27 × 11.69 (A4).
- Bleed: 0.125 in (3.2 mm) on top, bottom and outside edges. Page size with bleed = trim width + 0.125 in, trim height + 0.25 in (6 × 9 becomes 6.125 × 9.25).
- Inside (gutter) margin by page count: 24–150 pages 0.375 in (9.6 mm); 151–300 0.5 in (12.7 mm); 301–500 0.625 in (15.9 mm); 501–700 0.75 in (19.1 mm); 701–828 0.875 in (22.3 mm).
- Outside, top and bottom margins: at least 0.25 in (6.4 mm) without bleed, 0.375 in (9.6 mm) with bleed.
- Page count, black ink on white paper: 24–828 for most trims (8.25 × 6 and 8.25 × 8.25: 24–800; 8.5 × 8.5 and 8.5 × 11: 24–590; 8.27 × 11.69: 24–780). Cream paper: 24–776 for most trims. Standard colour: 72–600.
- KDP accepts a print-ready PDF for the interior; fonts must be embedded.

## Book Studio, as deployed at the time of writing (free web app and Obsidian plugin 0.1.3)

- Free, MIT licensed, by Siulved54 (publisher name on samples: Hidden Problems Lab). Web app: https://perezamadorluisenrique-gif.github.io/book-studio/ . Obsidian plugin: https://obsidian.md/plugins?id=book-studio . Source: https://github.com/perezamadorluisenrique-gif/book-studio .
- Runs entirely in the browser (or in Obsidian, desktop and mobile). Nothing is uploaded; no account, no cookies, no analytics. The web app keeps settings in the browser's local storage.
- Input: a folder of Markdown notes (for example an Obsidian vault). One "book note" with `book: true` in its front matter lists the chapters as `[[links]]` under headings `## Front matter`, `## Chapters`, `## Back matter` (Spanish headings also work: `## Preliminares`, `## Capítulos`, `## Parte final`). `### Part …` headings make part pages. Its properties hold title, author, language, publisher, ISBNs, copyright, dedication, epigraph, cover, theme, trim.
- Opening a folder: Chrome and Edge use the folder picker and can reopen the last folder; other browsers choose a folder through the file dialog. Exports download as files.
- Output: a print-ready PDF interior and an EPUB 3. Exported EPUBs pass W3C EPUBCheck 5.2.1 with no errors or warnings (both sample books, checked on every site build). Every sample PDF passes Book Studio's own KDP check (page box = trim, inside margin for the page count, all fonts embedded, 24–828 pages) on every build.
- Typesetting: Knuth–Plass line breaking (the algorithm TeX uses), hyphenation in English (US and UK), Spanish, French, German, Italian and Portuguese, smart quotes and dashes, widows and orphans avoided, drop caps, ornamental scene breaks, chapter openers, part pages, running heads, chapters that open on a right-hand page.
- KDP specifics: inside margin grows with page count to KDP's minimum; optional bleed; embedded fonts; pads to KDP's 24-page minimum; reports the spine width for the cover designer.
- Front and back matter built for you: half title, title page, copyright page (ISBN, edition, publisher), dedication, epigraph, table of contents, "Also by" page, footnotes collected as endnotes ("Notes").
- EPUB: semantic XHTML, navigable table of contents and landmarks, embedded fonts, cover, the book's language on every page, image descriptions from the Markdown alt text. An accessibility check flags images without a description.
- Writing in the web app (since book-studio #17–#19): "My books" keeps books in this browser only (IndexedDB), so clearing the site's data deletes them; a chapter editor that saves about half a second after the last key; a chapter list (front matter, chapters, back matter) reordered by dragging or with Alt+↑/↓; a book-details form (title, author, language, ISBN with check digit, keywords limited to seven, description, copyright, dedication, epigraph) and a JPG or PNG front cover. The interface is in English and Spanish.
- Importing a manuscript (web app, free, nothing uploaded): a `.md`, `.txt` or Word `.docx` file, or pasted text, becomes a new book. Chapters start at `#` headings, at `##` when the text has a single `#` title, or at lines such as "Chapter 3" / "Capítulo 3". From Word it keeps headings, bold and italic, lists, quotes, footnotes, links, page breaks and PNG/JPG pictures with their alt text. It leaves out tables, text boxes, equations, comments and the table of contents, and a report lists what was left out. Tracked changes are accepted. Old `.doc` files are not read (save as .docx); the limit is 40 MB. Tested with files from python-docx, pandoc and LibreOffice; not yet with files saved by Word itself or Google Docs.
- Publish checklist (web app, free; not the Pro preflight): the book's title, author, language, description, a cover image, no empty chapters, an empty Problems tab and no picture without a description are required; keywords and an ISBN are tips (KDP can give a free ISBN). It shows the page count and the spine estimate, and the steps to take on KDP.
- Default copyright line when the book gives none: "Copyright © year author. All rights reserved.", or in Spanish "Todos los derechos reservados." for books whose language is Spanish.
- Live paged preview (facing pages, zoom), and a Problems tab listing broken links and missing images with the note and line.
- Free plan (since book-studio #11; widened in November 2026): all twelve KDP trims, the Classic, Modern, Elegant, Non-fiction and Large Print themes, footnotes at the page foot, the full wraparound cover (spine width, bleed, barcode area), the KDP preflight with a report, the KDP metadata sheet, print PDF and EPUB, unlimited books, no time limit. Free designs print with no watermark; a genre theme exported without a key carries a SAMPLE watermark. Everything in this line stays free for good (`FREE_SINCE_2026_11` in `tests/entitlements.test.ts`).
- Book Studio supports 12 of KDP's 16 trims (not 8.25 × 6, 8.25 × 8.25, 8.5 × 8.5, 8.27 × 11.69).
- Book Studio Pro (one-time purchase; sale page https://perezamadorluisenrique-gif.github.io/pro/book-studio/ and `/es/`, "Coming soon" until the payment link exists): the genre themes (Thriller, Romance, Fantasy), a back-of-book index, several editions in one export, box sets, the accessible-EPUB pack (accessibility metadata, image-description audit, conformance claim and report). Source: `PRO_FEATURES` in `src/engine/entitlements.ts`. Say "Pro adds …" once per page; never a price; never call anything that is free today a Pro feature.

## Landing pages (2026-11-10)

`/es/` and `/en/` are sales pages built by `tools/site.mjs` from `site/<lang>/index.md`. Their comparison table uses only the facts above; where this file has no fact about a competitor (cover, Spanish), it says "Its site doesn't say". Their before/after picture is the engine set in `plain` mode against the normal one, same book and same font (`tools/landing-shots.ts`): it shows what the engine adds, not a screenshot of any word processor. Never claim "editorial quality" or "same as Vellum".

## Sample books on the site

| Id | Book | Language | Trim | Theme | Download paths (scheme) |
|---|---|---|---|---|---|
| `oz` | L. Frank Baum, *The Wonderful Wizard of Oz* (1900) | en | 6 × 9 | Classic | `download:oz/pdf`, `download:oz/epub`, `download:oz/zip` |
| `leyendas` | Gustavo Adolfo Bécquer, *Leyendas y rimas* (6 legends + the Rimas, 1912 text, Project Gutenberg #53552) | es | 6 × 9 | Modern | `download:leyendas/pdf`, `download:leyendas/epub`, `download:leyendas/zip` |

The app opens Oz by default; `app:?sample=leyendas` opens the Spanish one.

## Other tools (prices from the vendors' own pages unless noted; checked 2026-11-02)

- **Vellum** (https://vellum.pub/): Mac only (macOS 13 or newer). Vellum Press 249.99 USD one-time for ebooks and paperbacks; Vellum Ebooks 199.99 USD (tax not included). Free to download and try; pay to generate. EPUB 3 and EPUB 2, print PDF (PDF/X-1a), 24 trim sizes, large print, polished styles. Strengths: design polish, ebook and print kept in sync.
- **Atticus** (https://www.atticus.io/): 147 USD one-time (per Kindlepreneur, whose founder co-created Atticus: https://kindlepreneur.com/atticus-review/). Runs in the browser and as an installable app on Windows, Mac, Linux and Chromebook; works offline after login but needs a connection to export and log in. Exports EPUB, print PDF and DOCX. Strengths: built-in editor, templates, cross-platform.
- **Kindle Create** (https://www.amazon.com/kindlecreate): free from Amazon, Windows and Mac. Imports a DOC/DOCX manuscript (PDF only for Print Replica ebooks). Produces a KPF file that you upload to KDP; the KPF is only for publishing on KDP (https://kdp.amazon.com/en_US/help/topic/GMUKXSTBCN6F2TGM). Can prepare an ebook and a paperback from one manuscript. Tables, lists and footnotes cannot be edited inside it.
- Honest limits of Book Studio to state in the comparison: no full word processor (the web app has a simple chapter editor: no comments, no track changes, no tables; the Obsidian plugin writes in Obsidian itself); no cover designer yet (it builds the full cover sheet and reports the spine width); fewer themes than Vellum; it is a young project by one developer.
