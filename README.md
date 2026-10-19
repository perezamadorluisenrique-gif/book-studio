# Book Studio

Turn a folder of Markdown notes into a **print-ready paperback PDF** for Amazon KDP and an **accessible EPUB 3** for every ebook store. Everything happens on your device: your manuscript is never uploaded anywhere.

No Pandoc, no LaTeX, nothing else to install, and it works on Obsidian mobile too.

**[Try it in your browser →](https://perezamadorluisenrique-gif.github.io/book-studio/)** The web app opens with a sample book, *The Wonderful Wizard of Oz*, already typeset.

Book Studio comes in two forms that share one engine and one interface:

- **An Obsidian plugin.** It works on the vault you write in, rebuilds the preview as you type and saves exports to a vault folder.
- **A web app.** Open a folder of Markdown files, such as your vault, in the browser. Nothing is uploaded.

Book Studio is free. This first version prints 6" × 9" paperbacks in the Classic and Modern themes and exports EPUB 3; more trims and themes are on the way.

## Features

- **One note is the book.** A manifest note lists the chapters as links, in order, under *Front matter*, *Chapters* and *Back matter*. Its properties hold the title, author, theme and trim. To reorder chapters, reorder the links.
- **Real typesetting.** Knuth–Plass line breaking, hyphenation in the book's language, smart quotes and dashes, old-style figures and small caps where the theme calls for them. Widows and orphans are avoided.
- **Themes with character.** Drop caps, ornamental scene breaks, chapter openers, part pages and running heads. Themes: Classic and Modern.
- **Ready for KDP.**
  - The 6" × 9" trim, the most common paperback size.
  - Inside margins that grow with the page count, as KDP requires.
  - Optional bleed, embedded fonts, chapters that open on a right-hand page, and padding to KDP's 24-page minimum.
  - The spine width is reported for your cover designer.
- **Front and back matter, built for you.** Half title, title page, copyright page (with ISBNs, edition and publisher), dedication, epigraph and table of contents, plus "Also by" and any notes you list.
- **Live paged preview.** Each page appears exactly as it will print. Zoom to fit the page or the width, and check facing pages side by side.
- **EPUB 3 for every store.** Semantic XHTML, a navigable table of contents and landmarks, embedded fonts, the cover, and the book's language on every page. Exports pass [EPUBCheck](https://www.w3.org/publishing/epubcheck/) with no messages.
- **Problems tab.** Broken links, missing images and chapters that can't be found are listed with the note and line they come from; in Obsidian, a click opens it.

## Writing a book

Create a note with `book: true` in its properties. That note is the manifest:

```markdown
---
book: true
title: The Lighthouse Keeper
subtitle: A Novel
author: Jane Doe
language: en
publisher: Harbor Press
isbn: 978-1-23456-789-7
ebook-isbn: 978-1-23456-790-3
copyright: "© 2026 Jane Doe. All rights reserved."
dedication: For my mother.
cover: images/cover.jpg
theme: classic
trim: 6x9
---

## Front matter
- [[Foreword]]

## Chapters
### Part One: The Sea
1. [[The Storm]]
2. [[Landfall|The Shore]]
3. ~~[[Cut Scene]]~~
### Part Two: The Light
4. [[The Keeper]]
5. [[Interlude]] unnumbered

%% Ideas for later:
- [[Sequel hook]]
%%

## Back matter
- [[Acknowledgments]]
- [[About the Author]]
```

- **Sections.** Links under *Front matter*, *Chapters* and *Back matter* go to those parts of the book. Section names in other languages work too ("Capítulos", "Kapitel", "Chapitres").
- **Parts.** A subheading inside *Chapters* starts a part, which gets its own part page.
- **Titles.** A chapter's title comes from the link alias (`[[Landfall|The Shore]]`), then the note's `title` property, then the file name. Leading numbers in file names, such as "01 The Cyclone", are dropped.
- **Drafts and comments.** A ~~struck-out~~ link is left out of the build. Anything inside `%% … %%` is ignored.
- **Unnumbered chapters.** Write `unnumbered` after a link, or set `numbered: false` in the chapter note. Front and back matter are never numbered.
- **Starting from a folder.** In Obsidian, *Create book from current folder* writes a manifest that lists the folder's notes.

Chapter notes are ordinary Markdown:
- **Scene breaks.** `* * *`, `***`, `---` or `# # #` on a line of its own become the theme's ornament.
- **Images.** `![[map.png|A hand-drawn map of the island]]` uses the alias as the image description. Write `decorative` as the alias for an image that carries no meaning.
- **Footnotes, block quotes, lists, tables and poetry** are all supported. For poetry, keep the line breaks.

### Manifest properties

| Property | Meaning |
| --- | --- |
| `title`, `subtitle`, `author` (or `authors`) | Title page, metadata and running heads |
| `language` | Hyphenation, quote style and EPUB language, for example `en`, `es`, `de`, `fr` |
| `publisher`, `year`, `edition`, `copyright` | Copyright page |
| `isbn`, `ebook-isbn` | Print ISBN on the copyright page; ebook ISBN as the EPUB identifier |
| `description`, `subjects` | Store description and subjects in the EPUB metadata |
| `series`, `series-number`, `also-by` | Series metadata and the "Also by" page |
| `dedication`, `epigraph`, `epigraph-source` | Their own pages in the front matter |
| `cover` | Cover image for the EPUB |
| `theme` | `classic` or `modern` |
| `trim` | `6x9` |
| `bleed` | `true` when images run off the page edge |
| `chapter-start` | `recto` (right-hand pages, the default) or `any` |
| `running-heads` | `author-title`, `title-chapter` or `none` |
| `toc`, `half-title`, `hyphenate`, `smart-quotes` | Turn those features on or off |
| `font-size` | Body size in points, from 7 to 24 |
| `scene-break` | Glyph to use for scene breaks, such as `❦` |

The studio's toolbar can override the theme and trim for a single export without editing the note.

## Privacy

- **Your notes, images and exports never leave your device.** Parsing, typesetting and PDF and EPUB generation all run locally.
- **Book Studio makes no network requests.** There is no account, no telemetry, no analytics and no ads.
- The plugin keeps its settings in its `data.json` in your vault. The web app keeps them in your browser's local storage.

## Installing

### Obsidian

Search for **Book Studio** under *Settings → Community plugins → Browse*. To install by hand instead:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/perezamadorluisenrique-gif/book-studio/releases/latest).
2. Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/book-studio/`.
3. Enable **Book Studio** under *Settings → Community plugins*.

Open the studio from the ribbon icon or the command palette. The commands are *Open studio*, *Export print PDF*, *Export EPUB* and *Create book from current folder*. Exports are saved to the folder chosen in settings, *Book Studio exports* by default. The plugin works on desktop and mobile and needs Obsidian 1.7.2 or later.

### Web app

Open [the web app](https://perezamadorluisenrique-gif.github.io/book-studio/) and choose **Open a folder** to load your own notes. To host it yourself, `npm run build:web` writes a static site to `dist/web/` that any static host can serve.

## Development

```sh
npm install
npm run build          # plugin (main.js, styles.css)
npm run build:all      # plugin and web app
npm run build:web      # just the web app
npm run dev            # unminified builds with source maps
npm run typecheck
npm run lint           # ESLint with Obsidian's plugin review rules
npm test               # Vitest: parsing, layout, EPUB, audit
npm run sample         # render the sample book to out/ from the command line
```

`npm run sample` runs the same pipeline from Node, which helps when checking output:

```sh
npm run sample -- path/to/folder
npm run sample -- --theme modern --out out/oz-modern
```

### Layout

```
src/engine/    Parsing, typesetting, PDF, EPUB and checks (no DOM, no Obsidian)
src/app/       The studio UI shared by both hosts: toolbar, preview, export dialogs
src/preview/   Canvas renderer for the paged preview
src/obsidian/  Plugin entry: view, commands, settings, vault access
src/web/       Web app entry: folder picker, downloads, local storage
tests/         Vitest suites
tools/         Command-line renderer
sample/oz/     The sample book
fonts/         Bundled typefaces
```

## Credits and licenses

- Book Studio is released under the [MIT License](LICENSE).
- The bundled fonts are under the [SIL Open Font License 1.1](fonts/OFL.txt): EB Garamond, Crimson Pro, Cormorant Garamond, Montserrat, Atkinson Hyperlegible and Inconsolata.
- The text of *The Wonderful Wizard of Oz* (L. Frank Baum, 1900) is in the public domain. The sample's cover and illustration were made for this project and are under the MIT License.
- Libraries: [pdf-lib](https://pdf-lib.js.org), [fontkit](https://github.com/foliojs/fontkit), [JSZip](https://stuk.github.io/jszip/), [marked](https://marked.js.org), [yaml](https://eemeli.org/yaml/) and [hyphen](https://github.com/ytiurin/hyphen).
