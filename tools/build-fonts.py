"""Rebuild the bundled OFL fonts in ../fonts from Google Fonts' variable sources.

Usage: python3 tools/build-fonts.py <download-dir>

<download-dir> must hold the files listed in SOURCES (fetched from
https://raw.githubusercontent.com/google/fonts/main/ofl/<family>/<file>).
Each variable font is pinned to static weights, subset to Latin + punctuation +
book ornaments, and stripped of hinting (print and canvas output do not need it).
None of these families declares a Reserved Font Name, so subsetting is allowed
under the OFL without renaming.
"""
import os
import sys

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SOURCES = {
    # output name: (source file, axis pins)
    "EBGaramond-Regular": ("ebgaramond__EBGaramond[wght].ttf", {"wght": 400}),
    "EBGaramond-Italic": ("ebgaramond__EBGaramond-Italic[wght].ttf", {"wght": 400}),
    "EBGaramond-Bold": ("ebgaramond__EBGaramond[wght].ttf", {"wght": 700}),
    "EBGaramond-BoldItalic": ("ebgaramond__EBGaramond-Italic[wght].ttf", {"wght": 700}),
    "CrimsonPro-Regular": ("crimsonpro__CrimsonPro[wght].ttf", {"wght": 400}),
    "CrimsonPro-Italic": ("crimsonpro__CrimsonPro-Italic[wght].ttf", {"wght": 400}),
    "CrimsonPro-Bold": ("crimsonpro__CrimsonPro[wght].ttf", {"wght": 700}),
    "CrimsonPro-BoldItalic": ("crimsonpro__CrimsonPro-Italic[wght].ttf", {"wght": 700}),
    "CormorantGaramond-Medium": ("cormorantgaramond__CormorantGaramond[wght].ttf", {"wght": 500}),
    "CormorantGaramond-MediumItalic": ("cormorantgaramond__CormorantGaramond-Italic[wght].ttf", {"wght": 500}),
    "Montserrat-Medium": ("montserrat__Montserrat[wght].ttf", {"wght": 500}),
    "Montserrat-SemiBold": ("montserrat__Montserrat[wght].ttf", {"wght": 600}),
    "AtkinsonHyperlegible-Regular": ("atkinsonhyperlegible__AtkinsonHyperlegible-Regular.ttf", {}),
    "AtkinsonHyperlegible-Italic": ("atkinsonhyperlegible__AtkinsonHyperlegible-Italic.ttf", {}),
    "AtkinsonHyperlegible-Bold": ("atkinsonhyperlegible__AtkinsonHyperlegible-Bold.ttf", {}),
    "AtkinsonHyperlegible-BoldItalic": ("atkinsonhyperlegible__AtkinsonHyperlegible-BoldItalic.ttf", {}),
    "Inconsolata-Regular": ("inconsolata__Inconsolata[wdth,wght].ttf", {"wdth": 100, "wght": 400}),
}

UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x180))  # Latin-1 + Latin Extended-A
    + list(range(0x218, 0x21C))  # Romanian comma-below letters
    + [0x2BC, 0x2C6, 0x2C7, 0x2D8, 0x2D9, 0x2DA, 0x2DB, 0x2DC, 0x2DD]
    + list(range(0x2000, 0x2070))  # general punctuation (dashes, quotes, ellipsis, ⁂)
    + [0x20AC, 0x2116, 0x2122, 0x2212, 0x2190, 0x2192]
    + [0x2619, 0x25C6, 0x2766, 0x2767]  # ornaments used for scene breaks
)

FEATURES = ["kern", "liga", "clig", "calt", "smcp", "c2sc", "onum", "lnum", "pnum", "tnum", "mark", "mkmk", "ccmp", "locl"]


def build(src_dir: str, out_dir: str) -> None:
    for name, (src, pins) in SOURCES.items():
        font = TTFont(os.path.join(src_dir, src))
        if "fvar" in font:
            font = instancer.instantiateVariableFont(font, pins, updateFontNames=False)
        opts = Options()
        opts.layout_features = FEATURES
        opts.hinting = False
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.drop_tables += ["STAT", "DSIG"]
        sub = Subsetter(opts)
        sub.populate(unicodes=UNICODES)
        sub.subset(font)
        out = os.path.join(out_dir, name + ".ttf")
        font.save(out)
        print(f"{name}: {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(sys.argv[1], os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts"))
