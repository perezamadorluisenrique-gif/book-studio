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

Not covered: a file saved by Google Docs or by Microsoft Word itself (neither was available when these were made). Add one when you have it.
Regenerate the expected files with `npx vitest run tests/import-docx.test.ts -u` and read the diff.
