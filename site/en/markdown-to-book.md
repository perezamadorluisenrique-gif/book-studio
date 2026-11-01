---
title: "Markdown to Book: Turn Obsidian Notes into PDF and EPUB"
description: "How to turn a folder of Markdown notes, in Obsidian or any editor, into a print PDF and an EPUB 3 with one book note that lists your chapters."
slug: markdown-to-book
pair: markdown-a-libro
updated: 2026-11-02
type: article
order: 4
---
To turn Markdown into a book, keep your chapters as separate notes and add one "book note" that lists them in order. Book Studio reads that note and builds a print PDF and an EPUB 3. It works with an Obsidian vault or any folder of `.md` files, and you can [open the app](app:) to try it with a sample.

## The idea

Most writers who use Markdown already have one note per chapter. Book Studio adds one more note, the book note. It has `book: true` in its front matter, and it lists the chapters as `[[links]]` under three headings. The order of the links is the order of the book.

## A minimal book note

```markdown
---
book: true
title: The Lantern Road
author: Jane Example
language: en
publisher: Example Press
theme: classic
trim: 6x9
---

## Front matter

- [[Dedication]]

## Chapters

### Part One

1. [[Chapter 1]]
2. [[Chapter 2]]

### Part Two

3. [[Chapter 3]]

## Back matter

- [[Acknowledgments]]
```

The properties hold the title, author, language, publisher, ISBNs, copyright, dedication, epigraph, cover, theme and trim. You only need to fill the ones you use. The headings are `## Front matter`, `## Chapters` and `## Back matter`. A `### Part …` heading makes a part page.

Spanish headings also work: `## Preliminares`, `## Capítulos` and `## Parte final`.

## What happens to the rest

Each linked note becomes a chapter, a piece of front matter or a piece of back matter. The book note also drives the pages around the text. Book Studio builds the half title, title page, copyright page, dedication, epigraph and table of contents. Footnotes become endnotes under "Notes". For what the layout engine does with the text itself, see the [free KDP book formatter overview](guide:free-kdp-book-formatter).

## Images

Write images the normal Markdown way and give them a description:

```markdown
![Dorothy and the Scarecrow on the yellow brick road](road.png)
```

The text in brackets becomes the alt text in the EPUB. The [accessible EPUB guide](guide:accessible-epub) explains why it matters. A missing image or a broken link shows up in the Problems tab, with the note and line.

## Opening your folder

In Chrome and Edge, the app uses the folder picker and can reopen your last folder. In other browsers, you choose the folder through the file dialog. Either way, the files stay on your device. Exports download as files.

If you use Obsidian, the Book Studio plugin does the same thing inside the app, on desktop and mobile. The plugin is listed at [obsidian.md/plugins](https://obsidian.md/plugins?id=book-studio).

## See a finished source

The best way to learn the format is to read a real one. Download the Markdown source of the Oz sample: [source folder of The Wonderful Wizard of Oz](download:oz/zip). Open its book note, then compare it with the [print PDF](download:oz/pdf) it produces.

## Output

You get a print-ready PDF interior for KDP and an EPUB 3. The free plan prints the 6 × 9 in trim with the Classic and Modern themes. Book Studio Pro adds every KDP trim and more themes (one-time purchase): [see Pro](pro:). To choose a size, read [KDP trim sizes](guide:kdp-trim-sizes).

## Next step

Ready for the whole process from folder to upload? Follow [how to format a book for KDP](guide:format-a-book-for-kdp). Or [open the app](app:) and load your notes.
