---
title: "Accessible EPUB 3: What It Takes and How to Export One"
description: "What makes an EPUB accessible, how to check it with EPUBCheck, and how Book Studio exports a clean EPUB 3 from your Markdown notes."
slug: accessible-epub
pair: epub-accesible
updated: 2026-11-02
type: article
order: 2
---
An accessible EPUB is one that a screen reader, a braille display or a reader with large text can use as easily as anyone else. Most of it comes from clean structure, which Markdown gives you almost for free. You can [open the app](app:) and export an EPUB 3 from your notes.

## What makes an EPUB accessible

Accessibility in an ebook is mostly a handful of habits done consistently.

- **Semantic structure.** Headings are real headings, lists are real lists, and a paragraph is a paragraph. Assistive technology uses that structure to move around the book. An EPUB made of styled text with no structure gives a reader nothing to navigate by.
- **A navigable table of contents.** The reader can jump to any chapter, and the EPUB declares landmarks such as the cover and the start of the text.
- **Language.** The book's language is declared, so a screen reader picks the right voice and pronunciation. This matters most in a bilingual or non-English book.
- **Image descriptions.** Every image that carries meaning needs a text alternative. Decorative images do not.
- **Reflowable text.** The reader chooses font size and colors. The book should not fight that.

## Image descriptions come from your Markdown

In Markdown, the description is the part in square brackets:

```markdown
![A map of the Emerald City and the roads leading to it](map.png)
```

Book Studio uses that text as the image's alternative text in the EPUB. Write what a person who cannot see the picture needs to know, not the file name. If an image has no description, Book Studio's accessibility check flags it, so you find the gap before you export.

## What Book Studio does

The free web app writes EPUB 3 with:

- semantic XHTML,
- a navigable table of contents and landmarks,
- embedded fonts,
- a cover,
- the book's language set on every page,
- image descriptions taken from your alt text.

You set the language in the book note's properties. See [from Markdown to a book](guide:markdown-to-book) for where it goes.

## Check it with EPUBCheck

EPUBCheck is the W3C's validator for EPUB files. It tells you whether the package is well formed. Book Studio's exported EPUBs pass EPUBCheck 5.2.1 with no errors or warnings, and both sample books are checked again on every build of this site.

You can run the same check on your own file. Download the sample and compare: [the EPUB of The Wonderful Wizard of Oz](download:oz/epub) and [the Spanish EPUB of Leyendas](download:leyendas/epub).

A passing EPUBCheck means the file is valid. It does not mean every image has a good description or that the reading order makes sense. A person still has to read the book with a screen reader or at least skim the structure.

## Accessibility in Pro

The accessible-EPUB pack in Book Studio Pro adds accessibility metadata, a conformance claim and a report. The structure, table of contents, language and image descriptions above are in the free plan. If you want more than a clean file, [Book Studio Pro](pro:) is where that pack lives (one-time purchase).

## A note on the law

The European Accessibility Act applies to ebooks sold in the EU since 28 June 2025. This is not legal advice; check what applies to you and your sales.

## Where this fits in publishing

Your EPUB and your print PDF come from the same notes, so you fix a description once and both outputs benefit. For the print side, read [KDP trim sizes, margins and bleed](guide:kdp-trim-sizes). For the whole process in order, read [how to format a book for KDP](guide:format-a-book-for-kdp).

[Open the app](app:) and export your first accessible EPUB, or go back to [all guides](hub:).
