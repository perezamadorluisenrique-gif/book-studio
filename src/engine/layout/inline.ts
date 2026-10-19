// Setting a paragraph: inline content → Knuth–Plass items → justified lines of
// positioned glyph runs. Handles hyphenation, explicit hyphens and dashes,
// non-breaking spaces, footnote markers, drop caps and small-caps lead-ins.

import type { FaceKey } from "../fonts";
import { FAMILIES, faceKey, familyFace } from "../fonts";
import type { Hyphenator } from "../hyphenate";
import { FIL, INFINITE_PENALTY, firstFit, knuthPlass, type KPBreak, type KPItem } from "../linebreak";
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
}

export interface SetLine {
  pieces: Piece[];
  /** Character offset (into the block's plain text) of the line's first character. */
  offset: number;
  overfull: boolean;
  hyphenated: boolean;
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
}

interface BoxData {
  text: string;
  face: FaceKey;
  size: number;
  tracking: number;
  dy: number;
  offset: number;
  strike?: boolean;
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
}

type Atom = { kind: "word"; pieces: WordPiece[] } | { kind: "space" } | { kind: "break" };

const SPACE_RE = /[\s\u2000-\u2006\u2008-\u200A\u205F\u3000]/u;
const NBSP_RE = /[\u00A0\u202F\u2007]/;
const DROP_RE = /^([“‘"'«‹¡¿([]*)([\p{L}\p{N}])/u;
const HYPHEN_PENALTY = 50;
const DASH_PENALTY = 100;

export class ParagraphSetter {
  constructor(
    private styler: Styler,
    private hyphenator: Hyphenator | null,
  ) {}

  set(inlines: Inline[], base: RunStyle, opts: SetOptions): SetParagraph {
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
    const build = (hyphenate: boolean) => this.items(working, base, { ...opts, hyphenate: hyphenate && !ragged }, firstIndent, ragged);
    let items = build(false);
    let breaks: KPBreak[] | null = null;
    if (ragged) {
      breaks = knuthPlass(items, { lineWidth, tolerance: 4, fitnessDemerits: 0 });
    } else {
      breaks = knuthPlass(items, { lineWidth, tolerance: 1 });
      if (!breaks && opts.hyphenate) {
        items = build(true);
        breaks = knuthPlass(items, { lineWidth, tolerance: 2 }) ?? knuthPlass(items, { lineWidth, tolerance: 6 });
      } else if (!breaks) {
        breaks = knuthPlass(items, { lineWidth, tolerance: 6 });
      }
    }
    breaks ??= firstFit(items, lineWidth);
    const lines = this.lines(items, breaks, lineWidth, indentFor, opts.align);
    if (dropCap && lines.length <= dropCap.lines) {
      // Too short for an initial; set it plainly.
      return this.set(inlines, base, { ...opts, dropCap: undefined, indent: 0 });
    }
    return { lines, dropCap };
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
    const raggedStretch = base.size * 3;
    if (indent > 0) items.push({ type: "box", width: indent, data: { text: "", face: "", size: 0, tracking: 0, dy: 0, offset: 0 } });
    let words = 0;
    const lead = opts.leadInWords ?? 0;
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
      words++;
      this.wordItems(atom.pieces, base, smallCapsLead, !!opts.hyphenate, space, items);
    }
    while (items.length && items[items.length - 1].type === "glue") items.pop();
    items.push({ type: "penalty", width: 0, penalty: INFINITE_PENALTY, flagged: false });
    items.push({ type: "glue", width: 0, stretch: ragged && opts.balance ? raggedStretch : FIL, shrink: 0 });
    items.push({ type: "penalty", width: 0, penalty: -INFINITE_PENALTY, flagged: false });
    return items;
  }

  private wordItems(pieces: WordPiece[], base: RunStyle, smallCapsLead: boolean, hyphenate: boolean, space: number, items: Item[]): void {
    const styler = this.styler;
    const word = pieces.map((p) => p.text).join("");
    // Break opportunities, as indices into `word` → kind.
    const points = new Map<number, "hyphen" | "explicit" | "dash" | "zw">();
    const anyCode = pieces.some((p) => p.style.code || p.style.href?.includes("://"));
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (i > 0 && i < word.length - 1) {
        if (ch === "-" && /\p{L}/u.test(word[i - 1]) && /\p{L}/u.test(word[i + 1])) points.set(i + 1, "explicit");
        else if ((ch === "—" || ch === "–") && i < word.length - 1) points.set(i + 1, "dash");
        else if (ch === "/" && anyCode) points.set(i + 1, "zw");
      }
      if (ch === "­") points.set(i, "hyphen");
      if (ch === "​") points.set(i, "zw");
    }
    if (hyphenate && this.hyphenator && !anyCode) {
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
        const raw = word.slice(segStart, cut).replace(/[\u00AD\u200B]/g, "");
        this.segmentBoxes(raw, rs, dy, piece, piece.offset + (segStart - start), space, items);
        const kind = cut < end ? points.get(cut) : undefined;
        if (kind === "hyphen") {
          const parts = styler.parts("-", rs);
          const p = parts[0];
          items.push({
            type: "penalty",
            width: styler.width("-", rs),
            penalty: HYPHEN_PENALTY,
            flagged: true,
            data: { hyphen: { text: "-", face: p.face, size: p.size, tracking: p.tracking, dy, offset: 0 } },
          });
        } else if (kind === "explicit") {
          items.push({ type: "penalty", width: 0, penalty: HYPHEN_PENALTY, flagged: true });
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
          penalty: HYPHEN_PENALTY,
          flagged: true,
          data: { hyphen: { text: "-", face: parts[0].face, size: parts[0].size, tracking: parts[0].tracking, dy, offset: 0 } },
        });
      } else if (kind && kind !== "hyphen" && end < word.length) {
        items.push({ type: "penalty", width: 0, penalty: kind === "dash" ? DASH_PENALTY : kind === "zw" ? 0 : HYPHEN_PENALTY, flagged: kind === "explicit" });
      }
    }
  }

  private segmentBoxes(text: string, rs: RunStyle, dy: number, piece: WordPiece, offset: number, space: number, items: Item[]): void {
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
        items.push({
          type: "box",
          width: this.styler.partWidth(p),
          data: { text: p.text, face: p.face, size: p.size, tracking: p.tracking, dy, offset: piece.note ? piece.offset : partOff, strike: piece.style.strike },
        });
        partOff += p.text.length;
      }
      off += chunk.length;
    }
  }

  private lines(items: Item[], breaks: KPBreak[], lineWidth: (i: number) => number, indentFor: (i: number) => number, align: Align): SetLine[] {
    const fonts = this.styler.fonts;
    const out: SetLine[] = [];
    let start = 0;
    breaks.forEach((br, li) => {
      let s = start;
      while (s < br.position && items[s].type !== "box") s++;
      type El = { kind: "text"; d: BoxData; text: string } | { kind: "gap"; w: number } | { kind: "glue"; w: number; stretch: number; shrink: number };
      const els: El[] = [];
      let offset: number | undefined;
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
          if (offset === undefined) offset = d.offset;
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
        if (d.text) pushText(d);
      }
      let natural = 0;
      let stretch = 0;
      let shrink = 0;
      const widths: number[] = [];
      for (const e of els) {
        let w = 0;
        if (e.kind === "text") w = fonts.width(e.d.face, e.text, e.d.size, e.d.tracking);
        else if (e.kind === "gap") w = e.w;
        else {
          w = e.w;
          if (e.stretch < FIL) stretch += e.stretch;
          shrink += e.shrink;
        }
        widths.push(w);
        natural += w;
      }
      const target = lineWidth(li);
      const last = li === breaks.length - 1 || (end.type === "penalty" && end.penalty === -INFINITE_PENALTY);
      let r = 0;
      if (align === "justify" && !last) {
        if (natural < target && stretch > 1e-9) r = (target - natural) / stretch;
        else if (natural > target && shrink > 0) r = Math.max(-1, (target - natural) / shrink);
      } else if (natural > target && shrink > 0) {
        r = Math.max(-1, (target - natural) / shrink);
      }
      const finalWidth = natural + (r >= 0 ? r * stretch : r * shrink);
      let x = indentFor(li);
      if (align === "center") x += (target - finalWidth) / 2;
      else if (align === "right") x += target - finalWidth;
      const pieces: Piece[] = [];
      els.forEach((e, i) => {
        if (e.kind === "text") {
          pieces.push({ x, dy: e.d.dy, text: e.text, face: e.d.face, size: e.d.size, tracking: e.d.tracking, width: widths[i], strike: e.d.strike });
          x += widths[i];
        } else if (e.kind === "gap") {
          x += e.w;
        } else if (e.stretch < FIL) {
          x += e.w + (r >= 0 ? r * e.stretch : r * e.shrink);
        }
      });
      out.push({ pieces, offset: offset ?? 0, overfull: finalWidth > target + 0.5, hyphenated });
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
        word.push({ text: String(n), style: { sup: true }, offset, note: true });
      }
    }
  }
  endWord();
  while (atoms.length && atoms[atoms.length - 1].kind !== "word") atoms.pop();
  while (atoms.length && atoms[0].kind === "space") atoms.shift();
  return atoms;
}
