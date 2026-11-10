# Word fixtures

Test inputs for `tests/import-docx.test.ts`; the expected results are in `expected/`.

- `word-like.docx`: made with python-docx (Word's own style names): title, headings, bold/italic, lists, quote, page breaks, a table, pictures with and without alt text.
- `pandoc.docx`: made with pandoc: footnotes, links, nested lists, quote, picture with alt text, Title/Author styles.
- `libreoffice.docx`: `pandoc.docx` opened and saved again by LibreOffice (how LibreOffice writes the same content).
- `spanish-patterns.docx`: no heading styles, "Capítulo N" lines, Spanish language and document properties.
- `tracked-and-extras.docx`: hand-written XML with tracked insertions/deletions, a comment mark, an equation, a text box, a table-of-contents line, and chapters at Heading 2.
- `formatting.docx`: hand-written XML: centered and right-aligned paragraphs, subscript, superscript, strike-through, small caps, a table with a merged row and column and a `|` in a cell, a text box (with its old-format copy in `mc:Fallback`).
- `structure.docx`: hand-written XML in Spanish: dedication, prologue, parts with chapters below them, epilogue, acknowledgments, about the author; double spaces, a tab at the start, two empty paragraphs and `***`, `~`, `*` as scene breaks, and a verse with manual line breaks.
- `own-styles.docx`: no headings, but a style of its own (`TituloCapitulo`) for three chapter titles, and a paragraph of 23 lines cut by hand.

Files made by other programs (T3.4), read by `importFile` and tested in `tests/import-sources.test.ts` (expected results in `expected/<file>.json`):

- `pandoc-novel-es.*`, `pandoc-essay-en.*` (docx, odt, rtf): made by pandoc from two Markdown books (a Spanish novel with parts, scene break, verse, list, picture and table; an English essay with nested lists, table, footnote and link).
- `lo-novel-es.*`, `lo-essay-en.*` (docx, odt, rtf): the pandoc Word files opened and saved again by LibreOffice. `lo-word-like.docx` is `word-like.docx` saved by LibreOffice.
- `word-like.odt/.rtf`, `pandoc.odt/.rtf`, `spanish-patterns.odt/.rtf`: LibreOffice's ODT and RTF versions of the earlier Word fixtures.
- `gdocs-novel.docx`, `gdocs-notes.docx`, `gdocs-plain.docx`: hand-written XML with the known habits of Google Docs exports (styles named `Heading1`, lists with `numId` and no style, a picture in `wp:anchor`, text split in many runs, a Title and Subtitle, footnotes, merged cells, a Spanish file with no styles at all). Not a real Google Docs download.

Not covered: a file saved by Microsoft Word itself or downloaded from Google Docs (neither was available when these were made). Add one when you have it. RTF pictures are not read.
Regenerate the expected files with `npx vitest run tests/import-docx.test.ts tests/import-sources.test.ts -u` and read the diff.
