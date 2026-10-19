// Font families, faces and shaping. The same fontkit shaping drives line breaking,
// the PDF writer and the canvas preview, so all three agree to the glyph.

// Default import: the ES build exports only `default`, unlike its typings.
import fontkit from "@pdf-lib/fontkit";

export const FONT_FILES = [
  "EBGaramond-Regular",
  "EBGaramond-Italic",
  "EBGaramond-Bold",
  "EBGaramond-BoldItalic",
  "CrimsonPro-Regular",
  "CrimsonPro-Italic",
  "CrimsonPro-Bold",
  "CrimsonPro-BoldItalic",
  "CormorantGaramond-Medium",
  "CormorantGaramond-MediumItalic",
  "Montserrat-Medium",
  "Montserrat-SemiBold",
  "AtkinsonHyperlegible-Regular",
  "AtkinsonHyperlegible-Italic",
  "AtkinsonHyperlegible-Bold",
  "AtkinsonHyperlegible-BoldItalic",
  "Inconsolata-Regular",
] as const;

export type FontFile = (typeof FONT_FILES)[number];

export interface Family {
  id: string;
  name: string;
  regular: FontFile;
  italic: FontFile;
  bold: FontFile;
  boldItalic: FontFile;
  /** The font has real small capitals (OpenType smcp). */
  smallCaps: boolean;
  /** The font has old-style figures (OpenType onum). */
  oldstyle: boolean;
}

export const FAMILIES: Record<string, Family> = {
  "eb-garamond": {
    id: "eb-garamond",
    name: "EB Garamond",
    regular: "EBGaramond-Regular",
    italic: "EBGaramond-Italic",
    bold: "EBGaramond-Bold",
    boldItalic: "EBGaramond-BoldItalic",
    smallCaps: true,
    oldstyle: true,
  },
  "crimson-pro": {
    id: "crimson-pro",
    name: "Crimson Pro",
    regular: "CrimsonPro-Regular",
    italic: "CrimsonPro-Italic",
    bold: "CrimsonPro-Bold",
    boldItalic: "CrimsonPro-BoldItalic",
    smallCaps: false,
    oldstyle: true,
  },
  cormorant: {
    id: "cormorant",
    name: "Cormorant Garamond",
    regular: "CormorantGaramond-Medium",
    italic: "CormorantGaramond-MediumItalic",
    bold: "CormorantGaramond-Medium",
    boldItalic: "CormorantGaramond-MediumItalic",
    smallCaps: true,
    oldstyle: true,
  },
  montserrat: {
    id: "montserrat",
    name: "Montserrat",
    regular: "Montserrat-Medium",
    italic: "Montserrat-Medium",
    bold: "Montserrat-SemiBold",
    boldItalic: "Montserrat-SemiBold",
    smallCaps: true,
    oldstyle: true,
  },
  atkinson: {
    id: "atkinson",
    name: "Atkinson Hyperlegible",
    regular: "AtkinsonHyperlegible-Regular",
    italic: "AtkinsonHyperlegible-Italic",
    bold: "AtkinsonHyperlegible-Bold",
    boldItalic: "AtkinsonHyperlegible-BoldItalic",
    smallCaps: false,
    oldstyle: false,
  },
  inconsolata: {
    id: "inconsolata",
    name: "Inconsolata",
    regular: "Inconsolata-Regular",
    italic: "Inconsolata-Regular",
    bold: "Inconsolata-Regular",
    boldItalic: "Inconsolata-Regular",
    smallCaps: false,
    oldstyle: false,
  },
};

export type Feature = "smcp" | "c2sc" | "onum" | "lnum";

/** A font file plus the OpenType features it is shaped with, e.g. "EBGaramond-Regular|onum,smcp". */
export type FaceKey = string;

export function faceKey(file: FontFile, features: Feature[] = []): FaceKey {
  return features.length ? `${file}|${[...new Set(features)].sort().join(",")}` : file;
}

export function parseFaceKey(key: FaceKey): { file: FontFile; features: Feature[] } {
  const [file, feats] = key.split("|");
  return { file: file as FontFile, features: feats ? (feats.split(",") as Feature[]) : [] };
}

export function familyFace(family: Family, bold: boolean, italic: boolean): FontFile {
  if (bold && italic) return family.boldItalic;
  if (bold) return family.bold;
  if (italic) return family.italic;
  return family.regular;
}

export type FontLoader = (file: FontFile) => Promise<Uint8Array>;

export interface ShapedGlyph {
  id: number;
  codePoints: number[];
  /** Advance including kerning, in font units. */
  xAdvance: number;
  xOffset: number;
  yOffset: number;
  /** Raw advance width from hmtx, in font units (what a PDF viewer uses before TJ adjustments). */
  advanceWidth: number;
}

export interface Shaped {
  glyphs: ShapedGlyph[];
  /** Total advance in font units. */
  width: number;
}

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
}

type FkFont = ReturnType<typeof fontkit.create>;

export class FontSet {
  private shapeCache = new Map<string, Shaped>();
  private pathCache = new Map<string, string>();

  private constructor(
    private fonts: Map<FontFile, FkFont>,
    readonly bytes: Map<FontFile, Uint8Array>,
  ) {}

  static async load(loader: FontLoader, files: readonly FontFile[] = FONT_FILES): Promise<FontSet> {
    const fonts = new Map<FontFile, FkFont>();
    const bytes = new Map<FontFile, Uint8Array>();
    await Promise.all(
      files.map(async (f) => {
        const b = await loader(f);
        bytes.set(f, b);
        fonts.set(f, fontkit.create(b));
      }),
    );
    return new FontSet(fonts, bytes);
  }

  private font(file: FontFile): FkFont {
    const f = this.fonts.get(file);
    if (!f) throw new Error(`Font not loaded: ${file}`);
    return f;
  }

  has(file: FontFile): boolean {
    return this.fonts.has(file);
  }

  metrics(file: FontFile): FontMetrics {
    const f = this.font(file);
    return { unitsPerEm: f.unitsPerEm, ascent: f.ascent, descent: f.descent, capHeight: f.capHeight, xHeight: f.xHeight };
  }

  shape(key: FaceKey, text: string): Shaped {
    const cacheKey = key + "\u0000" + text;
    const hit = this.shapeCache.get(cacheKey);
    if (hit) return hit;
    const { file, features } = parseFaceKey(key);
    const font = this.font(file);
    const run = font.layout(text, features.length ? features : undefined);
    const glyphs: ShapedGlyph[] = run.glyphs.map((g, i) => ({
      id: g.id,
      codePoints: g.codePoints,
      xAdvance: run.positions[i].xAdvance,
      xOffset: run.positions[i].xOffset,
      yOffset: run.positions[i].yOffset,
      advanceWidth: g.advanceWidth,
    }));
    const shaped = { glyphs, width: glyphs.reduce((s, g) => s + g.xAdvance, 0) };
    if (this.shapeCache.size > 200_000) this.shapeCache.clear();
    this.shapeCache.set(cacheKey, shaped);
    return shaped;
  }

  /** Width in points of `text` set in `key` at `size`, with optional tracking (points per glyph). */
  width(key: FaceKey, text: string, size: number, tracking = 0): number {
    if (!text) return 0;
    const { file } = parseFaceKey(key);
    const shaped = this.shape(key, text);
    return (shaped.width / this.font(file).unitsPerEm) * size + tracking * shaped.glyphs.length;
  }

  covers(file: FontFile, codePoint: number): boolean {
    return this.font(file).hasGlyphForCodePoint(codePoint);
  }

  /** Characters in `text` the font has no glyph for. */
  missing(file: FontFile, text: string): string[] {
    const font = this.font(file);
    const out = new Set<string>();
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x20 || cp === 0xad || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff) continue;
      if (!font.hasGlyphForCodePoint(cp)) out.add(ch);
    }
    return [...out];
  }

  /** SVG path data for a glyph in font units (y up), for the canvas preview. */
  glyphPath(file: FontFile, glyphId: number): string {
    const k = file + ":" + glyphId;
    let d = this.pathCache.get(k);
    if (d === undefined) {
      d = this.font(file).getGlyph(glyphId).path.toSVG();
      this.pathCache.set(k, d);
    }
    return d;
  }

  unitsPerEm(file: FontFile): number {
    return this.font(file).unitsPerEm;
  }
}
