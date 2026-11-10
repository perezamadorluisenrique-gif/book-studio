// Setting a paragraph: inline content → Knuth–Plass items → justified lines of
// positioned glyph runs. Handles hyphenation, explicit hyphens and dashes,
// non-breaking spaces, footnote markers, drop caps and small-caps lead-ins.

import type { FaceKey } from "../fonts";
import { FAMILIES, faceKey, familyFace } from "../fonts";
import type { Hyphenator } from "../hyphenate";
import { FIL, INFINITE_PENALTY, breakParagraph, firstFit, type KPBreak, type KPItem, type KPOptions } from "../linebreak";
import type { Inline, InlineStyle } from "../model";
import type { RunStyle, Styler } from "./style";

export interface Piece {
  x: number;
  /** Baseline shift, positive downwards (superscripts are negative). */
  dy: number;
  text: string;
  face: FaceKey;
  size: number;
  tracking: number;
  width: number;
  strike?: boolean;
  /** Horizontal stretch of the glyphs from letter expansion; absent means 1. `width` already includes it. */
  scale?: number;
}

export interface SetLine {
  pieces: Piece[];
  /** Character offset (into the block's plain text) of the line's first character. */
  offset: number;
  overfull: boolean;
  hyphenated: boolean;
  /** Adjustment ratio the line was set with: above 0 its spaces were stretched, below 0 squeezed. 0 on the last line and in unjustified text. */
  ratio: number;
  /** Footnotes called from this line, in order. */
  notes: string[];
}

export interface DropCap {
  text: string;
  face: FaceKey;
  size: number;
  /** Lines the initial spans; its baseline sits on the last of them. */
  lines: number;
}

export interface SetParagraph {
  lines: SetLine[];
  dropCap?: DropCap;
  /** Whether the line-break search could use hyphenation points. */
  hyphenated: boolean;
}

export type Align = "justify" | "left" | "center" | "right";

export interface SetOptions {
  width: number;
  align: Align;
  /** First-line indent in points. */
  indent?: number;
  hyphenate?: boolean;
  dropCap?: { lines: number; family: string; leading: number };
  /** Words after the drop cap (or at the start) set in small caps. */
  leadInWords?: number;
  noteNumber?: (id: string) => number | undefined;
  /** Display text: make the last line count too, so lines come out even. */
  balance?: boolean;
  /** Microtypography for justified text: hanging punctuation at the margins and letters that stretch up to 2 %. */
  micro?: boolean;
}

interface BoxData {
  text: string;
  face: FaceKey;
  size: number;
  tracking: number;
  dy: number;
  offset: number;
  strike?: boolean;
  noteId?: string;
}

interface PenaltyData {
  hyphen?: BoxData;
}

type Item = KPItem<BoxData | PenaltyData>;

interface WordPiece {
  text: string;
  style: InlineStyle;
  offset: number;
  note?: boolean;
  noteId?: string;
}

type Atom = { kind: "word"; pieces: WordPiece[] } | { kind: "space" } | { kind: "break" };

const SPACE_RE = /[\s\u2000-\u2006\u2008-\u200A\u205F\u3000]/u;
const NBSP_RE = /[\u00A0\u202F\u2007]/;
const DROP_RE = /^([“‘"'«‹¡¿—([]*)([\p{L}\p{N}])/u;
/** How far each character hangs into the margin, as a fraction of its own width. */
const HANG_RIGHT: Record<string, number> = { "-": 0.7, ",": 0.7, ".": 0.7, ":": 0.4, ";": 0.4, "’": 0.6, "”": 0.6, "'": 0.6, '"': 0.6, "»": 0.3, "!": 0.2, "?": 0.2, "–": 0.3, "—": 0.2 };
const HANG_LEFT: Record<string, number> = { "‘": 0.6, "“": 0.6, "'": 0.6, '"': 0.6, "«": 0.3, "¿": 0.1, "¡": 0.1, "(": 0.1 };
/** Letters may grow or shrink by this fraction of their width to even out the spaces. */
const EXPAND = 0.02;
const HYPHEN_PENALTY = 50;
/** A capitalised word in mid-sentence is probably a name; splitting one reads worse. */
const NAME_HYPHEN_PENALTY = 150;
const DASH_PENALTY = 100;
/** How far the spaces of a paragraph re-set for the page builder may stretch: never a loose line. */
const VARIANT_TOLERANCE = 0.95;

/** A short text for the inline flags of a style, to tell styles apart in a cache key. */
const STYLE_SIGS = new WeakMap<InlineStyle, string>();
function styleSig(st: InlineStyle): string {
  let sig = STYLE_SIGS.get(st);
  if (sig === undefined) {
    sig = `${st.italic ? "i" : ""}${st.bold ? "b" : ""}${st.code ? "c" : ""}${st.smallCaps ? "s" : ""}${st.strike ? "x" : ""}${st.sup ? "^" : ""}${st.sub ? "_" : ""}${st.href ?? ""}`;
    STYLE_SIGS.set(st, sig);
  }
  return sig;
}

/** The parts of a run style that change how a word is turned into items. */
function baseSig(b: RunStyle): string {
  return `${b.family}|${b.size}|${b.bold ? 1 : 0}${b.italic ? 1 : 0}|${b.caps ?? "none"}|${b.uppercase ? 1 : 0}|${b.tracking ?? 0}|${b.oldstyle ? 1 : 0}`;
}

/** For an item list: how far each item's source offset lies from the `offset` its data holds (words are shared between paragraphs). */
const BASES = new WeakMap<Item[], number[]>();

/** Most words kept before the memo starts over. */
const WORD_MEMO_LIMIT = 150_000;

export class ParagraphSetter {
  private words = new Map<string, Item[]>();
  /** The paragraph `set` prepared last, for `variants` to pick up when asked right after for the same paragraph. */
  private last: { inlines: Inline[]; base: RunStyle; opts: SetOptions; prep: ReturnType<ParagraphSetter["prepare"]> } | null = null;

  constructor(
    private styler: Styler,
    private hyphenator: Hyphenator | null,
  ) {}

  /** The parts of a paragraph every way of setting it shares: atoms without the initial, and line widths. */
  private prepare(inlines: Inline[], base: RunStyle, opts: SetOptions) {
    const atoms = tokenize(inlines, opts.noteNumber);
    let dropCap: DropCap | undefined;
    let dropWidth = 0;
    let working = atoms;
    if (opts.dropCap) {
      const r = this.extractDropCap(atoms, base, opts.dropCap);
      if (r) {
        dropCap = r.dropCap;
        dropWidth = r.width;
        working = r.atoms;
      }
    }
    const indentFor = (line: number) => (dropCap && line < dropCap.lines ? dropWidth : 0);
    const lineWidth = (line: number) => opts.width - indentFor(line);
    const firstIndent = dropCap ? 0 : (opts.indent ?? 0);
    const ragged = opts.align !== "justify";
    const hyphens = !ragged && !!opts.hyphenate && this.hyphenator !== null;
    // Items for each way of hyphenating, made once: `set` and `variants` of the same paragraph share them.
    const built: [Item[] | null, Item[] | null] = [null, null];
    const build = (hyphenate: boolean): Item[] => {
      const k = hyphenate ? 1 : 0;
      return (built[k] ??= this.items(working, base, { ...opts, hyphenate: hyphenate && hyphens }, firstIndent, ragged));
    };
    // What the line breaker is told besides the tolerance: no ladders of hyphens, no hyphen before the
    // last line, no last line shorter than two ems.
    const common: Omit<KPOptions, "tolerance"> = {
      lineWidth,
      maxHyphenRun: 2,
      finalHyphenDemerits: 5000,
      lastLineMin: Math.max(2 * firstIndent, 2 * base.size),
      runtDemerits: 10000,
      flaggedDemerits: 10000,
    };
    return { dropCap, indentFor, lineWidth, ragged, hyphens, build, common };
  }

  set(inlines: Inline[], base: RunStyle, opts: SetOptions): SetParagraph {
    const prep = this.prepare(inlines, base, opts);
    this.last = { inlines, base, opts, prep };
    const { dropCap, indentFor, lineWidth, ragged, hyphens, build, common } = prep;
    let items = build(false);
    let breaks: KPBreak[] | null = null;
    let hyphenated = false;
    if (ragged) {
      breaks = breakParagraph(items, { lineWidth, tolerance: 4, fitnessDemerits: 0 })?.breaks ?? null;
    } else {
      const attempt = (tolerances: number[]) => {
        for (const tolerance of tolerances) {
          const r = breakParagraph(items, { ...common, tolerance });
          if (r) return r.breaks;
        }
        return null;
      };
      breaks = attempt([0.7]);
      if (!breaks && hyphens) {
        items = build(true);
        hyphenated = true;
        breaks = attempt([1, 1.6, 2.5, 6]);
      } else if (!breaks) {
        breaks = attempt([1, 2, 4, 8]);
      }
    }
    breaks ??= firstFit(items, lineWidth);
    const lines = this.lines(items, breaks, lineWidth, indentFor, opts.align, !!opts.micro);
    if (dropCap && lines.length <= dropCap.lines) {
      // Too short for an initial; set it plainly.
      return this.set(inlines, base, { ...opts, dropCap: undefined, indent: 0 });
    }
    return { lines, dropCap, hyphenated };
  }

  /**
   * The same justified paragraph set in exactly `lines` lines, for the page builder to try; `null` when that
   * can't be done. The returned function shares the paragraph's items between calls.
   */
  variants(inlines: Inline[], base: RunStyle, opts: SetOptions): (lines: number) => SetParagraph | null {
    type Prep = ReturnType<ParagraphSetter["prepare"]> & { items: Item[]; natural: number; stretch: number; shrink: number; slack: number; forced: boolean };
    let prep: Prep | null = null;
    // Called right after `set` for the same paragraph: what `set` prepared is still good.
    const shared = this.last && this.last.inlines === inlines && this.last.base === base && this.last.opts === opts ? this.last.prep : null;
    return (lines) => {
      if (!prep) {
        const p = shared ?? this.prepare(inlines, base, opts);
        const items = p.ragged ? [] : p.build(true);
        // Totals for a cheap test of whether the text can fill that many lines at all.
        let natural = 0;
        let stretch = 0;
        let shrink = 0;
        let widest = 0;
        let forced = false;
        items.forEach((it, k) => {
          if (it.type === "penalty") {
            widest = Math.max(widest, it.width);
            if (it.penalty === -INFINITE_PENALTY && k < items.length - 1) forced = true;
            return;
          }
          if (it.type === "glue" && it.stretch >= FIL / 2) return;
          natural += it.width;
          stretch += it.stretch ?? 0;
          shrink += it.shrink ?? 0;
          if (it.type === "glue") widest = Math.max(widest, it.width);
        });
        prep = { ...p, items, natural, stretch, shrink, slack: widest + base.size, forced };
      }
      const ready: Prep = prep;
      const { dropCap, indentFor, lineWidth, ragged, hyphens, common, items } = ready;
      if (ragged || lines < 1 || (dropCap && lines <= dropCap.lines)) return null;
      if (!ready.forced) {
        let room = 0;
        for (let k = 0; k < lines - 1; k++) room += lineWidth(k);
        // Too little text to fill all the lines but the last, or too much to fit in all of them.
        if (ready.natural + VARIANT_TOLERANCE * ready.stretch + lines * ready.slack < room) return null;
        if (ready.natural - ready.shrink - lines * ready.slack > room + lineWidth(lines - 1)) return null;
      }
      const r = breakParagraph(items, { ...common, tolerance: VARIANT_TOLERANCE, lineCount: lines });
      if (!r) return null;
      return { lines: this.lines(items, r.breaks, lineWidth, indentFor, opts.align, !!opts.micro), dropCap, hyphenated: hyphens };
    };
  }

  variant(inlines: Inline[], base: RunStyle, opts: SetOptions, lines: number): SetParagraph | null {
    return this.variants(inlines, base, opts)(lines);
  }

  private extractDropCap(atoms: Atom[], base: RunStyle, dc: NonNullable<SetOptions["dropCap"]>) {
    const first = atoms[0];
    if (!first || first.kind !== "word" || first.pieces[0].note || first.pieces[0].style.code) return null;
    const piece = first.pieces[0];
    const m = DROP_RE.exec(piece.text);
    if (!m) return null;
    const fonts = this.styler.fonts;
    const family = FAMILIES[dc.family] ?? FAMILIES[base.family];
    const file = familyFace(family, false, false);
    const bodyFile = familyFace(FAMILIES[base.family] ?? family, !!base.bold, !!base.italic);
    const bm = fonts.metrics(bodyFile);
    const dm = fonts.metrics(file);
    const height = (dc.lines - 1) * dc.leading + (bm.capHeight / bm.unitsPerEm) * base.size;
    const size = height / (dm.capHeight / dm.unitsPerEm);
    const face = faceKey(file);
    const width = fonts.width(face, m[0], size) + base.size * 0.3;
    const rest = piece.text.slice(m[0].length);
    const pieces = rest ? [{ ...piece, text: rest, offset: piece.offset + m[0].length }, ...first.pieces.slice(1)] : first.pieces.slice(1);
    let out: Atom[];
    if (pieces.length) out = [{ kind: "word", pieces }, ...atoms.slice(1)];
    else out = atoms.slice(1).filter((a, i) => !(i === 0 && a.kind === "space"));
    return { dropCap: { text: m[0], face, size, lines: dc.lines }, width, atoms: out };
  }

  private runStyle(base: RunStyle, st: InlineStyle, smallCapsLead: boolean): { rs: RunStyle; dy: number } {
    let rs: RunStyle = { ...base };
    if (st.italic) rs.italic = !base.italic;
    if (st.bold) rs.bold = true;
    if ((st.smallCaps || smallCapsLead) && (rs.caps ?? "none") === "none") rs.caps = "smcp";
    if (st.code) rs = { family: "inconsolata", size: base.size * 0.88 };
    let dy = 0;
    if (st.sup) {
      rs = { ...rs, size: rs.size * 0.62, oldstyle: false };
      dy = -base.size * 0.36;
    } else if (st.sub) {
      rs = { ...rs, size: rs.size * 0.62, oldstyle: false };
      dy = base.size * 0.14;
    }
    return { rs, dy };
  }

  private items(atoms: Atom[], base: RunStyle, opts: SetOptions, indent: number, ragged: boolean): Item[] {
    const items: Item[] = [];
    const styler = this.styler;
    const space = styler.width(" ", base);
    const sig = baseSig(base);
    const bases: number[] = [];
    BASES.set(items, bases);
    const micro = !!opts.micro && !ragged;
    const raggedStretch = base.size * 3;
    if (indent > 0) items.push({ type: "box", width: indent, data: { text: "", face: "", size: 0, tracking: 0, dy: 0, offset: 0 } });
    let words = 0;
    const lead = opts.leadInWords ?? 0;
    let prevWord = "";
    for (const atom of atoms) {
      if (atom.kind === "space") {
        const prev = items[items.length - 1];
        if (!prev || prev.type !== "box") continue;
        if (ragged) {
          items.push({ type: "glue", width: 0, stretch: raggedStretch, shrink: 0 });
          items.push({ type: "penalty", width: 0, penalty: 0, flagged: false });
          items.push({ type: "glue", width: space, stretch: -raggedStretch, shrink: 0 });
        } else {
          items.push({ type: "glue", width: space, stretch: space / 2, shrink: space / 3 });
        }
        continue;
      }
      if (atom.kind === "break") {
        while (items.length && items[items.length - 1].type === "glue") items.pop();
        items.push({ type: "glue", width: 0, stretch: FIL, shrink: 0 });
        items.push({ type: "penalty", width: 0, penalty: -INFINITE_PENALTY, flagged: false });
        continue;
      }
      const smallCapsLead = words < lead;
      const text = atom.pieces.map((p) => p.text).join("");
      // A name: starts with a capital, is not the first word, and doesn't follow the end of a sentence.
      const name = words > 0 && /^\p{Lu}/u.test(text) && !/[.!?…]["'”’»)\]]*$/.test(prevWord);
      prevWord = text;
      words++;
      this.cachedWord(atom.pieces, base, sig, smallCapsLead, !!opts.hyphenate, space, items, bases, micro, name ? NAME_HYPHEN_PENALTY : HYPHEN_PENALTY);
    }
    while (items.length && items[items.length - 1].type === "glue") items.pop();
    items.push({ type: "penalty", width: 0, penalty: INFINITE_PENALTY, flagged: false });
    items.push({ type: "glue", width: 0, stretch: ragged && opts.balance ? raggedStretch : FIL, shrink: 0 });
    items.push({ type: "penalty", width: 0, penalty: -INFINITE_PENALTY, flagged: false });
    return items;
  }

  /** `wordItems` through a memo: the same word in the same style comes out as the same items wherever it stands. */
  private cachedWord(pieces: WordPiece[], base: RunStyle, sig: string, smallCapsLead: boolean, hyphenate: boolean, space: number, items: Item[], bases: number[], micro: boolean, hyphenPenalty: number): void {
    const first = pieces[0].offset;
    let key = `${sig}|${smallCapsLead ? 1 : 0}${hyphenate ? 1 : 0}${micro ? 1 : 0}|${hyphenPenalty}`;
    for (const p of pieces) key += `\u0001${styleSig(p.style)}${p.note ? `\u0002${p.noteId}` : ""}\u0003${p.offset - first}\u0003${p.text}`;
    let tpl = this.words.get(key);
    if (!tpl) {
      tpl = [];
      this.wordItems(
        pieces.map((p) => ({ ...p, offset: p.offset - first })),
        base,
        smallCapsLead,
        hyphenate,
        space,
        tpl,
        micro,
        hyphenPenalty,
      );
      if (this.words.size >= WORD_MEMO_LIMIT) this.words.clear();
      this.words.set(key, tpl);
    }
    // The items are shared; each remembers where this occurrence of the word starts.
    while (bases.length < items.length) bases.push(0);
    for (const it of tpl) {
      items.push(it);
      bases.push(first);
    }
  }

  private wordItems(pieces: WordPiece[], base: RunStyle, smallCapsLead: boolean, hyphenate: boolean, space: number, items: Item[], micro: boolean, hyphenPenalty: number): void {
    const styler = this.styler;
    const word = pieces.map((p) => p.text).join("");
    // Break opportunities, as indices into `word` → kind.
    const points = new Map<number, "hyphen" | "explicit" | "dash" | "zw">();
    // The author's controls: a soft hyphen (U+00AD) marks the only places a word may be split, and a word
    // joiner (U+2060) anywhere in it forbids splitting it at all. Words with digits are never hyphenated.
    const noSplit = word.includes("\u2060");
    const soft = word.includes("\u00AD");
    const hasDigit = /\p{N}/u.test(word);
    const anyCode = pieces.some((p) => p.style.code || p.style.href?.includes("://"));
    for (let i = 0; i < word.length && !noSplit; i++) {
      const ch = word[i];
      if (i > 0 && i < word.length - 1) {
        if (ch === "-" && /\p{L}/u.test(word[i - 1]) && /\p{L}/u.test(word[i + 1])) points.set(i + 1, "explicit");
        else if ((ch === "—" || ch === "–") && i > 0 && i < word.length - 1) points.set(i + 1, "dash");
        else if (ch === "/" && anyCode) points.set(i + 1, "zw");
      }
      if (ch === "­") points.set(i, "hyphen");
      if (ch === "​") points.set(i, "zw");
    }
    if (hyphenate && this.hyphenator && !anyCode && !noSplit && !soft && !hasDigit) {
      const re = /\p{L}+/gu;
      for (let m = re.exec(word); m; m = re.exec(word)) {
        if (m[0].length < 5) continue;
        for (const p of this.hyphenator.points(m[0])) {
          const at = m.index + p;
          if (!points.has(at)) points.set(at, "hyphen");
        }
      }
    }
    let pos = 0;
    for (const piece of pieces) {
      const { rs, dy } = this.runStyle(base, piece.style, smallCapsLead);
      const start = pos;
      const end = pos + piece.text.length;
      const cuts = [...points.keys()].filter((p) => p > start && p < end).sort((a, b) => a - b);
      let segStart = start;
      for (const cut of [...cuts, end]) {
        const raw = word.slice(segStart, cut).replace(/[\u00AD\u200B\u2060]/g, "");
        this.segmentBoxes(raw, rs, dy, piece, piece.offset + (segStart - start), space, items, micro);
        const kind = cut < end ? points.get(cut) : undefined;
        if (kind === "hyphen") {
          const parts = styler.parts("-", rs);
          const p = parts[0];
          items.push({
            type: "penalty",
            width: styler.width("-", rs),
            penalty: hyphenPenalty,
            flagged: true,
            pr: micro ? HANG_RIGHT["-"] * styler.width("-", rs) : undefined,
            data: { hyphen: { text: "-", face: p.face, size: p.size, tracking: p.tracking, dy, offset: 0 } },
          });
        } else if (kind === "explicit") {
          items.push({ type: "penalty", width: 0, penalty: hyphenPenalty, flagged: true });
        } else if (kind === "dash") {
          items.push({ type: "penalty", width: 0, penalty: DASH_PENALTY, flagged: false });
        } else if (kind === "zw") {
          items.push({ type: "penalty", width: 0, penalty: 0, flagged: false });
        }
        segStart = cut;
      }
      pos = end;
      // A hyphenation point exactly at a style boundary.
      const kind = points.get(end);
      if (kind === "hyphen" && end < word.length) {
        const parts = styler.parts("-", rs);
        items.push({
          type: "penalty",
          width: styler.width("-", rs),
          penalty: hyphenPenalty,
          flagged: true,
          pr: micro ? HANG_RIGHT["-"] * styler.width("-", rs) : undefined,
          data: { hyphen: { text: "-", face: parts[0].face, size: parts[0].size, tracking: parts[0].tracking, dy, offset: 0 } },
        });
      } else if (kind && kind !== "hyphen" && end < word.length) {
        items.push({ type: "penalty", width: 0, penalty: kind === "dash" ? DASH_PENALTY : kind === "zw" ? 0 : hyphenPenalty, flagged: kind === "explicit" });
      }
    }
  }

  private segmentBoxes(text: string, rs: RunStyle, dy: number, piece: WordPiece, offset: number, space: number, items: Item[], micro: boolean): void {
    if (!text) return;
    // Non-breaking spaces become fixed gaps that glue the word together.
    const chunks = text.split(/([\u00A0\u202F\u2007])/);
    let off = offset;
    for (const chunk of chunks) {
      if (!chunk) continue;
      if (NBSP_RE.test(chunk) && chunk.length === 1) {
        const w = chunk === " " ? space * 0.5 : chunk === " " ? this.styler.width("0", rs) : space;
        items.push({ type: "box", width: w, data: { text: "", face: "", size: 0, tracking: 0, dy: 0, offset: off } });
        off += 1;
        continue;
      }
      let partOff = off;
      for (const p of this.styler.parts(chunk, rs)) {
        const width = this.styler.partWidth(p);
        const hang = micro && !piece.note && !piece.style.code;
        const first = hang ? [...p.text][0] : "";
        const last = hang ? [...p.text].pop()! : "";
        const fonts = this.styler.fonts;
        items.push({
          type: "box",
          width,
          ...(hang
            ? {
                stretch: width * EXPAND,
                shrink: width * EXPAND,
                pl: (HANG_LEFT[first] ?? 0) * (HANG_LEFT[first] ? fonts.width(p.face, first, p.size) : 0),
                pr: (HANG_RIGHT[last] ?? 0) * (HANG_RIGHT[last] ? fonts.width(p.face, last, p.size) : 0),
              }
            : {}),
          data: { text: p.text, face: p.face, size: p.size, tracking: p.tracking, dy, offset: piece.note ? piece.offset : partOff, strike: piece.style.strike, noteId: piece.note ? piece.noteId : undefined },
        });
        partOff += p.text.length;
      }
      off += chunk.length;
    }
  }

  private lines(items: Item[], breaks: KPBreak[], lineWidth: (i: number) => number, indentFor: (i: number) => number, align: Align, micro: boolean): SetLine[] {
    const fonts = this.styler.fonts;
    const bases = BASES.get(items) ?? [];
    const out: SetLine[] = [];
    let start = 0;
    breaks.forEach((br, li) => {
      let s = start;
      while (s < br.position && items[s].type !== "box") s++;
      type El = { kind: "text"; d: BoxData; text: string } | { kind: "gap"; w: number } | { kind: "glue"; w: number; stretch: number; shrink: number };
      const els: El[] = [];
      let offset: number | undefined;
      const notes: string[] = [];
      const pushText = (d: BoxData) => {
        const last = els[els.length - 1];
        if (last?.kind === "text" && last.d.face === d.face && last.d.size === d.size && last.d.tracking === d.tracking && last.d.dy === d.dy && !!last.d.strike === !!d.strike) {
          last.text += d.text;
        } else {
          els.push({ kind: "text", d, text: d.text });
        }
      };
      for (let i = s; i < br.position; i++) {
        const it = items[i];
        if (it.type === "box") {
          const d = it.data as BoxData;
          if (offset === undefined) offset = d.offset + (bases[i] ?? 0);
          if (d.noteId) notes.push(d.noteId);
          if (d.text) pushText(d);
          else els.push({ kind: "gap", w: it.width });
        } else if (it.type === "glue") {
          els.push({ kind: "glue", w: it.width, stretch: it.stretch, shrink: it.shrink });
        }
      }
      const end = items[br.position];
      let hyphenated = false;
      if (end.type === "penalty" && (end.data as PenaltyData | undefined)?.hyphen) {
        pushText((end.data as PenaltyData).hyphen!);
        hyphenated = true;
      } else if (end.type === "penalty" && end.flagged) {
        hyphenated = true;
      } else if (end.type === "box") {
        const d = end.data as BoxData;
        if (d.noteId) notes.push(d.noteId);
        if (d.text) pushText(d);
      }
      let natural = 0;
      let stretch = 0;
      let shrink = 0;
      let textWidth = 0;
      const widths: number[] = [];
      for (const e of els) {
        let w = 0;
        if (e.kind === "text") {
          w = fonts.width(e.d.face, e.text, e.d.size, e.d.tracking);
          textWidth += w;
        } else if (e.kind === "gap") w = e.w;
        else {
          w = e.w;
          if (e.stretch < FIL) stretch += e.stretch;
          shrink += e.shrink;
        }
        widths.push(w);
        natural += w;
      }
      // Hanging punctuation: the line may stick out past the measure by what its first and last characters hang.
      let hangLeft = 0;
      let hangRight = 0;
      if (micro && align === "justify") {
        const first = items[s];
        if (first?.type === "box") hangLeft = first.pl ?? 0;
        if (end.type === "penalty" && end.width > 0) hangRight = end.pr ?? 0;
        else {
          for (let k = br.position - 1; k >= s; k--) {
            const it = items[k];
            if (it.type === "box") {
              hangRight = it.pr ?? 0;
              break;
            }
          }
        }
      }
      const target = lineWidth(li) + hangLeft + hangRight;
      const last = li === breaks.length - 1 || (end.type === "penalty" && end.penalty === -INFINITE_PENALTY);
      // Letters give a little too (up to EXPAND of their width) before the spaces take the rest.
      const E = micro && align === "justify" ? EXPAND : 0;
      const letters = textWidth * E;
      let r = 0;
      let scale = 1;
      const deficit = target - natural;
      if (align === "justify" && !last && deficit > 0) {
        if (stretch > 1e-9 || letters > 1e-9) {
          const rt = deficit / (stretch + letters);
          if (rt <= 1) {
            r = rt;
            scale = 1 + rt * E;
          } else {
            scale = 1 + E;
            r = stretch > 1e-9 ? (deficit - letters) / stretch : 0;
          }
        }
      } else if (deficit < 0 && (shrink > 0 || letters > 0)) {
        r = Math.max(-1, deficit / (shrink + letters));
        scale = 1 + r * E;
      }
      const finalWidth = natural + (scale - 1) * textWidth + (r >= 0 ? r * stretch : r * shrink);
      let x = indentFor(li) - hangLeft;
      if (align === "center") x += (target - finalWidth) / 2;
      else if (align === "right") x += target - finalWidth;
      const pieces: Piece[] = [];
      els.forEach((e, i) => {
        if (e.kind === "text") {
          const w = widths[i] * scale;
          pieces.push({ x, dy: e.d.dy, text: e.text, face: e.d.face, size: e.d.size, tracking: e.d.tracking, width: w, strike: e.d.strike, scale: scale !== 1 ? scale : undefined });
          x += w;
        } else if (e.kind === "gap") {
          x += e.w;
        } else if (e.stretch < FIL) {
          x += e.w + (r >= 0 ? r * e.stretch : r * e.shrink);
        }
      });
      out.push({ pieces, offset: offset ?? 0, overfull: finalWidth > target + 0.5, hyphenated, ratio: align === "justify" && !last ? r : 0, notes });
      start = br.position + 1;
    });
    return out;
  }
}

function tokenize(inlines: Inline[], noteNumber?: (id: string) => number | undefined): Atom[] {
  const atoms: Atom[] = [];
  let word: WordPiece[] | null = null;
  let offset = 0;
  const endWord = () => {
    if (word && word.some((p) => p.text)) atoms.push({ kind: "word", pieces: word.filter((p) => p.text) });
    word = null;
  };
  const addChar = (ch: string, style: InlineStyle, at: number) => {
    word ??= [];
    const last: WordPiece | undefined = word[word.length - 1];
    if (last && last.style === style && !last.note) last.text += ch;
    else word.push({ text: ch, style, offset: at });
  };
  for (const inl of inlines) {
    if (inl.kind === "text") {
      for (const ch of inl.text) {
        if (SPACE_RE.test(ch) && !NBSP_RE.test(ch)) {
          endWord();
          if (atoms.length && atoms[atoms.length - 1].kind !== "space") atoms.push({ kind: "space" });
        } else {
          addChar(ch, inl.style, offset);
        }
        offset += ch.length;
      }
    } else if (inl.kind === "break") {
      endWord();
      while (atoms.length && atoms[atoms.length - 1].kind === "space") atoms.pop();
      atoms.push({ kind: "break" });
      offset += 1;
    } else {
      const n = noteNumber?.(inl.noteId);
      if (n !== undefined) {
        word ??= [];
        word.push({ text: String(n), style: { sup: true }, offset, note: true, noteId: inl.noteId });
      }
    }
  }
  endWord();
  while (atoms.length && atoms[atoms.length - 1].kind !== "word") atoms.pop();
  while (atoms.length && atoms[0].kind === "space") atoms.shift();
  return atoms;
}
