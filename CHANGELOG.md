# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.1.0

First release.

- A note with `book: true` is the book: it lists the chapters, in order, as links under *Front matter*, *Chapters* and *Back matter*, with parts as subheadings.
- Print PDF for Amazon KDP at 6" × 9": Knuth–Plass line breaking, hyphenation, smart quotes, embedded fonts, chapters on right-hand pages and an inside margin that grows with the page count. The spine width is reported for your cover designer.
- EPUB 3 export that passes EPUBCheck.
- Classic and Modern themes, title and copyright pages, dedication, epigraph and table of contents.
- Live paged preview that rebuilds as you type, and a Problems tab.
- *Create book from current folder* writes a book note for a folder of chapters.
- Works on desktop and mobile. No network requests.
