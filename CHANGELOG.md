# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## Unreleased

- Free: unlimited books, and the 5" × 8" and 5.5" × 8.5" trims next to 6" × 9".
- Book Studio Pro, unlocked by an offline Ed25519 license key (checked on the device, no network): more themes and trims, large print, KDP preflight with an HTML report, a full wraparound cover with barcode space, footnotes at the page foot, a back-of-book index, editions, a KDP details sheet and box sets.
- Without a key, the print PDF of a Pro design carries a SAMPLE watermark.
- New manifest properties: `paper`, `footnotes`, `index-terms`, `editions`, `back-blurb`, `author-bio`, `author-photo`, `tagline`, `cover-background`, `cover-ink`, `spine-title`.

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
