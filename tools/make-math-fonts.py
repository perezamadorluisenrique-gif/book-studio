#!/usr/bin/env python3
"""Builds fonts/STIXTwoMath-Regular.ttf and -Italic.ttf from STIX Two Math (SIL OFL 1.1).

Usage: python3 tools/make-math-fonts.py path/to/STIXTwoMath-Regular.ttf
(the npm package @fontsource/stix-two-math ships it as a .woff; fonttools opens both).
Needs: pip install fonttools brotli

Regular: the glyphs formulas use (Latin, Greek, operators, arrows, brackets), without the
MATH, GSUB and GPOS tables. Italic: the same, with the cmap of Latin letters and lower-case
Greek pointed at the Mathematical Italic glyphs, so a formula keeps real letters in the
text (copyable, readable by screen readers) and still prints in math italic.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools import subset

SRC = sys.argv[1]
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0300-0308,U+030C,U+0305,U+0307,U+0391-03C9,U+03D1,U+03D5,U+03D6,U+03F1,U+03F5,"
    "U+2005,U+2009,U+2003,U+2010-2015,U+2018-201D,U+2020-2022,U+2026,U+2032-2034,U+2070-209F,U+20D7,U+2113,U+210F,"
    "U+2111,U+211C,U+2135,U+2190-21A6,U+21D0-21D5,U+2200-2237,U+223C-2265,U+226A-2273,U+2282-228B,U+2295-2299,"
    "U+22A5,U+22C5,U+22C6,U+22EE-22F1,U+2308-230B,U+27E8,U+27E9,U+2016,U+2225,U+2220,U+1D434-1D467,U+1D6FC-1D714"
)

def build(italic: bool, out: str) -> None:
    f = TTFont(SRC)
    f.flavor = None
    if italic:
        for t in f["cmap"].tables:
            if not t.isUnicode():
                continue
            c = t.cmap
            for i in range(26):
                for base, it in ((0x41, 0x1D434), (0x61, 0x1D44E)):
                    g = c.get(it + i) or (c.get(0x210E) if (base == 0x61 and i == 7) else None)
                    if g:
                        c[base + i] = g
            for i in range(25):  # lower-case Greek alpha..omega (U+03B1..) -> math italic (U+1D6FC..)
                g = c.get(0x1D6FC + i)
                if g:
                    c[0x3B1 + i] = g
    opts = subset.Options()
    opts.drop_tables += ["MATH", "GSUB", "GPOS", "GDEF"]
    opts.layout_features = []
    opts.notdef_outline = True
    opts.name_IDs = [1, 2, 3, 4, 6, 13, 14]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(f)
    f.save(out)

build(False, "fonts/STIXTwoMath-Regular.ttf")
build(True, "fonts/STIXTwoMath-Italic.ttf")
