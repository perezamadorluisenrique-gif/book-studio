# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.2.0

- Free: unlimited books, every trim size, the full wraparound cover with barcode space, footnotes at the page foot and the KDP checks.
- Better pages: a page builder that searches each chapter for full, even pages, balanced facing pages, optical margins, no hyphen ladders or runts, per-language hyphenation and Spanish typography.
- Faster layout: paginating is cached and runs off the main thread in the web app.
- Cover editor with templates, back cover, barcode and cover exports.
- Import a Word, ODT or RTF manuscript with a word-count check, and export the book back to Word.
- Portrait photos that carry an EXIF orientation tag now keep their orientation in the PDF instead of turning sideways.
- Callout paragraphs after the first are set flush left, without a first-line indent.
- Checkboxes are 24 px on touch screens and narrow windows.
- Book notes can use Spanish section headings: `## Preliminares`, `## Capítulos`, `## Parte final` or `## Apéndices`.
- Web app: guides for KDP authors in English and Spanish, sample books and downloadable sample PDFs, EPUBs and sources.

## 0.1.3

- `![[Report.pdf]]` and other embeds that aren't notes or images are left out with a warning, instead of printing the file's raw bytes as text.
- Footnotes in an embedded note now reach the book, numbered apart from the host note's.
- Editing an embedded note refreshes the preview.
- Exporting right after an edit includes that edit.
- The settings appear in Obsidian's settings search (Obsidian 1.13 and later).
- The PDF and EPUB name the real Book Studio version as their producer.

## 0.1.2

- Remove the runtime script injection and dynamic code from the bundle: JSZip's setimmediate and lie polyfills are replaced by native Promise and a timer-based setImmediate.

## 0.1.1

- The studio no longer shows an *Accessibility report* button or an *Accessibility* tab, which belong to a later edition and did nothing in this one.

## 0.1.0

First release.

- A note with `book: true` is the book: it lists the chapters, in order, as links under *Front matter*, *Chapters* and *Back matter*, with parts as subheadings.
- Print PDF for Amazon KDP at 6" × 9": Knuth–Plass line breaking, hyphenation, smart quotes, embedded fonts, chapters on right-hand pages and an inside margin that grows with the page count. The spine width is reported for your cover designer.
- EPUB 3 export that passes EPUBCheck.
- Classic and Modern themes, title and copyright pages, dedication, epigraph and table of contents.
- Live paged preview that rebuilds as you type, and a Problems tab.
- *Create book from current folder* writes a book note for a folder of chapters.
- Works on desktop and mobile. No network requests.
