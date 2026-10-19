// Turning a run of text plus a style into font faces: picks the face for
// bold/italic, applies small caps (real or synthesized), old-style figures and
// tracking, and falls back to another bundled font for characters a face lacks.

import { FAMILIES, faceKey, familyFace, parseFaceKey, type FaceKey, type Feature, type FontFile, type FontSet } from "../fonts";
import type { TextStyle } from "../themes";

/** "smcp": lowercase letters become small caps; "all": capitals too. */
export type CapsMode = "none" | "smcp" | "all";

export interface RunStyle {
  family: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  caps?: CapsMode;
  uppercase?: boolean;
  /** Points added after every glyph. */
  tracking?: number;
  oldstyle?: boolean;
}

export interface StyledPart {
  text: string;
  face: FaceKey;
  size: number;
  tracking: number;
}

const SYNTH_SC_SCALE = 0.78;
const FALLBACK_FILES: FontFile[] = ["EBGaramond-Regular", "AtkinsonHyperlegible-Regular", "CrimsonPro-Regular", "Inconsolata-Regular"];

export function fromTextStyle(ts: TextStyle, oldstyle: boolean): RunStyle {
  return {
    family: ts.family,
    size: ts.size,
    bold: ts.bold,
    italic: ts.italic,
    caps: ts.smallCaps ? "all" : "none",
    uppercase: ts.uppercase,
    tracking: (ts.tracking ?? 0) * ts.size,
    oldstyle,
  };
}

export class Styler {
  private cache = new Map<string, StyledPart[]>();

  constructor(
    readonly fonts: FontSet,
    readonly lang: string,
  ) {}

  /** Split `text` into parts that each use a single face and size. */
  parts(text: string, s: RunStyle): StyledPart[] {
    const key = `${s.family}|${s.size}|${s.bold ? 1 : 0}${s.italic ? 1 : 0}|${s.caps ?? "none"}|${s.uppercase ? 1 : 0}|${s.tracking ?? 0}|${s.oldstyle ? 1 : 0}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const out = this.compute(text, s);
    if (this.cache.size > 100_000) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  width(text: string, s: RunStyle): number {
    let w = 0;
    for (const p of this.parts(text, s)) w += this.fonts.width(p.face, p.text, p.size, p.tracking);
    return w;
  }

  partWidth(p: StyledPart): number {
    return this.fonts.width(p.face, p.text, p.size, p.tracking);
  }

  private compute(text: string, s: RunStyle): StyledPart[] {
    const family = FAMILIES[s.family] ?? FAMILIES["eb-garamond"];
    const file = familyFace(family, !!s.bold, !!s.italic);
    const tracking = s.tracking ?? 0;
    const features: Feature[] = [];
    if (s.oldstyle && family.oldstyle) features.push("onum");
    const t = s.uppercase ? text.toLocaleUpperCase(this.lang) : text;
    const caps = s.caps ?? "none";
    const raw: StyledPart[] = [];
    if (caps !== "none" && family.smallCaps) {
      features.push("smcp");
      if (caps === "all") features.push("c2sc");
      raw.push({ text: t, face: faceKey(file, features), size: s.size, tracking });
    } else if (caps !== "none") {
      // Synthesized small caps: capitals of a smaller size, slightly tracked out.
      const small = s.size * SYNTH_SC_SCALE;
      const smallTracking = tracking + s.size * 0.02;
      const face = faceKey(file, features);
      let buf = "";
      let bufSmall = false;
      const flush = () => {
        if (buf) raw.push({ text: buf, face, size: bufSmall ? small : s.size, tracking: bufSmall ? smallTracking : tracking });
        buf = "";
      };
      for (const ch of t) {
        const isLower = /\p{Ll}/u.test(ch);
        const isSmall = isLower || (caps === "all" && /\p{L}|\p{N}/u.test(ch));
        if (isSmall !== bufSmall && buf) flush();
        bufSmall = isSmall;
        buf += isLower ? ch.toLocaleUpperCase(this.lang) : ch;
      }
      flush();
    } else {
      raw.push({ text: t, face: faceKey(file, features), size: s.size, tracking });
    }
    return raw.flatMap((p) => this.withFallback(p));
  }

  /** Re-assign characters the face cannot draw to a bundled font that can. */
  private withFallback(p: StyledPart): StyledPart[] {
    const { file, features } = parseFaceKey(p.face);
    const fonts = this.fonts;
    const ok = (f: FontFile, cp: number) => fonts.has(f) && fonts.covers(f, cp);
    let allCovered = true;
    for (const ch of p.text) {
      const cp = ch.codePointAt(0)!;
      if (!isInvisible(cp) && !ok(file, cp)) {
        allCovered = false;
        break;
      }
    }
    if (allCovered) return [p];
    const out: StyledPart[] = [];
    let buf = "";
    let bufFace = p.face;
    for (const ch of p.text) {
      const cp = ch.codePointAt(0)!;
      let face = p.face;
      if (!isInvisible(cp) && !ok(file, cp)) {
        const alt = FALLBACK_FILES.find((f) => f !== file && ok(f, cp));
        if (alt) face = faceKey(alt, features.filter((f) => f === "onum" || f === "lnum"));
      }
      if (face !== bufFace && buf) {
        out.push({ ...p, text: buf, face: bufFace });
        buf = "";
      }
      bufFace = face;
      buf += ch;
    }
    if (buf) out.push({ ...p, text: buf, face: bufFace });
    return out;
  }
}

function isInvisible(cp: number): boolean {
  return cp < 0x20 || cp === 0xad || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff;
}
