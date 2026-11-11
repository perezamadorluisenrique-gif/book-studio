---
title: "ISBN Checker and Barcode Maker for KDP Paperbacks"
description: "Check that an ISBN-10 or ISBN-13 is valid, convert ISBN-10 to ISBN-13, and download its EAN-13 barcode as SVG or PNG. Free and private."
tool: isbn
updated: 2026-11-11
---
Paste an ISBN with or without hyphens. The tool checks it, shows the ISBN-13, and draws the barcode that goes on the back cover.

{{tool}}

{{figures}}

## How the check works

The last digit of an ISBN is a check digit, calculated from the others, so a typo is almost always caught. For an ISBN-13, multiply the first 12 digits alternately by 1 and 3, add them up, and the check digit is whatever brings the total to a multiple of 10. An ISBN-10 uses weights from 10 down to 1 and a total divisible by 11, with X standing for 10. A book ISBN-13 starts with 978 or 979. An ISBN-10 becomes an ISBN-13 by putting 978 in front of its first nine digits and working out a new check digit.

Hyphens are only for reading: where they go depends on the registration group and publisher, so they can't be worked out from the digits. This tool checks the number, not whether the ISBN has been assigned to a book.

## The barcode

Bookland barcodes are EAN-13 symbols of the ISBN-13: 95 modules with a quiet zone of 11 modules on the left and 7 on the right, black bars on white. You can upload a cover with or without a barcode. If you don't supply one, KDP puts a barcode on the back cover for you; if you do, leave the lower right corner of the back cover clear for it. KDP's help page does not publish a barcode size, so check the template for your trim size.

## Next

Your cover also needs its [full size and a template](tool:cover). [Book Studio](app:) can put the barcode on the back cover from the ISBN in your book's details.
