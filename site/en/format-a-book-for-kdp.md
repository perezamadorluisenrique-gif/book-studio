---
title: "How to Format a Book for KDP: Step by Step, Free"
description: "Format a paperback and ebook for Amazon KDP in seven steps, from Markdown notes to a print-ready PDF and an EPUB 3, using a free browser app."
slug: format-a-book-for-kdp
pair: como-formatear-un-libro-para-kdp
updated: 2026-11-02
type: howto
order: 6
steps:
  - Write your chapters as notes
  - Create the book note
  - Choose the trim size
  - Open your folder in the app
  - Fix the problems
  - Export the PDF and EPUB
  - Check and upload to KDP
---
To format a book for KDP, you need a print-ready PDF interior with the right trim size and margins, and an EPUB for the ebook. These steps get you both from Markdown notes with a free tool. You can [open the app](app:) in another tab and follow along with the sample book.

## 1. Write your chapters as notes

Keep one Markdown note per chapter, in any editor. Obsidian works well, and so does a plain folder of `.md` files. Add image descriptions as you go: `![description](image.png)`.

## 2. Create the book note

Add one more note with `book: true` in its front matter. Under `## Front matter`, `## Chapters` and `## Back matter`, list your notes as `[[links]]`. Put the title, author, language, publisher, ISBNs and copyright in its properties. The format is shown in [from Markdown to a book](guide:markdown-to-book).

## 3. Choose the trim size

Pick your trim before you worry about anything else, because it decides the page count and the margins. The free plan prints 6 × 9 in, KDP's most common paperback size. Book Studio Pro adds every KDP trim (one-time purchase): [see Pro](pro:). All the KDP trims, the margin table and the bleed rules are in [KDP trim sizes, margins and bleed](guide:kdp-trim-sizes).

The inside margin depends on page count, and Book Studio sets it for you:

| Page count | Inside margin |
|---|---|
| 24–150 | 0.375 in (9.6 mm) |
| 151–300 | 0.5 in (12.7 mm) |
| 301–500 | 0.625 in (15.9 mm) |
| 501–700 | 0.75 in (19.1 mm) |
| 701–828 | 0.875 in (22.3 mm) |

## 4. Open your folder in the app

In the app, choose your folder. Chrome and Edge use the folder picker and can reopen your last folder. Other browsers use the file dialog. Nothing is uploaded; the work happens on your device. The preview shows facing pages, and you can zoom in.

## 5. Fix the problems

Open the Problems tab. It lists broken links and missing images with the note and the line. If an image has no description, the accessibility check flags it. Fix them in your notes.

Decide on bleed here. You need it only if an image or color reaches the page edge. With bleed on, a 6 × 9 page becomes 6.125 × 9.25 in. Most text-only books do not need it.

## 6. Export the PDF and EPUB

Export the print PDF and the EPUB. Book Studio builds the front and back matter, applies the inside margin for your page count, embeds the fonts and pads the book to KDP's 24-page minimum. It also reports the spine width. Your cover designer needs that number, because the free plan has no cover designer of its own.

The EPUB has a navigable table of contents, the book's language on every page and your image descriptions. To see what is checked, read [the accessible EPUB guide](guide:accessible-epub).

## 7. Check and upload to KDP

Open the PDF and page through it. Look at the first page of each chapter, the table of contents and any images. Compare it with a finished example: the [sample print PDF](download:oz/pdf) and the [sample EPUB](download:oz/epub).

Then upload the PDF as your paperback interior and the EPUB as your ebook manuscript in KDP. KDP accepts a print-ready PDF for the interior and requires embedded fonts. Your cover is a separate file. KDP's own page on [trim size, bleed and margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) is the final authority, so read it once before you submit.

## If something looks wrong

Check the page count first. If it crossed a threshold in the table above, the inside margin changed and the text reflowed. Then check the trim. Then check images. If you are weighing other tools, see [Book Studio against Vellum, Atticus and Kindle Create](guide:vellum-atticus-kindle-create).

For a short overview of what the app does, read [the free KDP book formatter page](guide:free-kdp-book-formatter), or go back to [all guides](hub:).

Ready to export? [Open the app](app:) and load your folder.
