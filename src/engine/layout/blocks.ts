// Block content → vertical material: paragraph lines, headings, scene breaks,
// quotes, lists, code, images, tables, chapter openers and endnotes.

import { chapterLabel } from "../i18n";
import { formatPages, type IndexEntry } from "../index-terms";
import type { Block, Chapter, ImageAsset, Inline, Note, SourceRef } from "../model";
import type { Theme, TextStyle } from "../themes";
import type { Align, ParagraphSetter, SetParagraph } from "./inline";
import { NO_BREAK, offsetDraw, type VBox, type VItem } from "./paginate";
import { fromTextStyle, type RunStyle, type Styler } from "./style";
import type { Draw, LayoutWarning, TextDraw } from "./types";

export interface FlowEnv {
  styler: Styler;
  setter: ParagraphSetter;
  theme: Theme;
  lang: string;
  bodySize: number;
  leading: number;
  /** Text block size in points. */
  width: number;
  capacity: number;
  hyphenate: boolean;
  sceneGlyph: string;
  images: Map<string, ImageAsset>;
  noteNumber: (id: string) => number | undefined;
  warn: (w: LayoutWarning) => void;
}

interface ParaState {
  noIndent: boolean;
  leadIn: number;
  dropCap: boolean;
}

interface Frame {
  left: number;
  width: number;
  base: RunStyle;
  /** Inside a list or quote: no drop caps, no first-line indents for the first paragraph. */
  nested: boolean;
}

export class FlowBuilder {
  readonly base: RunStyle;
  /** Baseline offset of a body line within its slot. */
  readonly baseline: number;

  constructor(private env: FlowEnv) {
    this.base = { family: env.theme.body.family, size: env.bodySize, oldstyle: env.theme.body.oldstyle };
    this.baseline = Math.round(env.bodySize * 0.74 * 100) / 100;
  }

  get L(): number {
    return this.env.leading;
  }

  get width(): number {
    return this.env.width;
  }

  get capacity(): number {
    return this.env.capacity;
  }

  style(ts: TextStyle): RunStyle {
    return fromTextStyle(ts, this.env.theme.body.oldstyle);
  }

  /** Height of a line of display type, rounded up to whole body lines. */
  slotHeight(size: number): number {
    return this.L * Math.max(1, Math.ceil((size * 1.15) / this.L - 0.01));
  }

  // ── Text helpers ───────────────────────────────────────────────

  drawsFor(set: SetParagraph, lineIndex: number, left: number, baseline: number): Draw[] {
    const line = set.lines[lineIndex];
    const draws: Draw[] = [];
    for (const p of line.pieces) {
      draws.push({ kind: "text", x: left + p.x, y: baseline + p.dy, text: p.text, face: p.face, size: p.size, tracking: p.tracking || undefined });
      if (p.strike) {
        const y = baseline + p.dy - p.size * 0.28;
        draws.push({ kind: "rule", x1: left + p.x, y1: y, x2: left + p.x + p.width, y2: y, width: p.size * 0.05 });
      }
    }
    return draws;
  }

  /** Lines of a set paragraph as boxes, with widow and orphan control. */
  lineBoxes(set: SetParagraph, opts: { left: number; blockId: string; src?: SourceRef; height?: number; baseline?: number; keepWithNext?: boolean; keepTogether?: boolean }): VBox[] {
    const h = opts.height ?? this.L;
    const b = opts.baseline ?? this.baseline;
    const n = set.lines.length;
    const boxes: VBox[] = [];
    for (let k = 0; k < n; k++) {
      const draws = this.drawsFor(set, k, opts.left, b);
      if (k === 0 && set.dropCap) {
        const dc = set.dropCap;
        draws.push({ kind: "text", x: opts.left, y: b + (dc.lines - 1) * h, text: dc.text, face: dc.face, size: dc.size });
      }
      const line = k + 1;
      let breakAfter = 0;
      if (line === n) breakAfter = opts.keepWithNext ? NO_BREAK : 0;
      else if (opts.keepTogether || line < 2 || n - line < 2) breakAfter = NO_BREAK;
      if (set.dropCap && line < set.dropCap.lines) breakAfter = NO_BREAK;
      if (set.lines[k].overfull) {
        this.env.warn({ severity: "warning", message: "A line is too long for the measure and sticks into the margin.", src: opts.src });
      }
      boxes.push({ type: "box", height: h, draws, breakAfter, start: { blockId: opts.blockId, offset: set.lines[k].offset }, src: opts.src, notes: set.lines[k].notes.length ? set.lines[k].notes : undefined });
    }
    return boxes;
  }

  setText(inlines: Inline[], style: RunStyle, width: number, align: Align): SetParagraph {
    return this.env.setter.set(inlines, style, { width, align, hyphenate: false, balance: true, noteNumber: this.env.noteNumber });
  }

  /** One line of plain text, positioned within `width`. */
  textLine(text: string, style: RunStyle, width: number, align: "left" | "center" | "right", baseline: number, left = 0): TextDraw[] {
    const parts = this.env.styler.parts(text, style);
    const total = parts.reduce((s, p) => s + this.env.styler.partWidth(p), 0);
    let x = left + (align === "center" ? (width - total) / 2 : align === "right" ? width - total : 0);
    const out: TextDraw[] = [];
    for (const p of parts) {
      out.push({ kind: "text", x, y: baseline, text: p.text, face: p.face, size: p.size, tracking: p.tracking || undefined });
      x += this.env.styler.partWidth(p);
    }
    return out;
  }

  textWidth(text: string, style: RunStyle): number {
    return this.env.styler.width(text, style);
  }

  // ── Chapters ───────────────────────────────────────────────────

  opener(chapter: Chapter): VItem[] {
    const { theme, lang } = this.env;
    const L = this.L;
    const items: VItem[] = [];
    const strut = (height: number): VBox => ({ type: "box", height, draws: [], breakAfter: NO_BREAK });
    const sink = Math.round((theme.chapter.sink * this.env.capacity) / L) * L;
    items.push({ ...strut(sink), start: { blockId: chapter.id, offset: 0 }, src: chapter.src });
    const ch = theme.chapter;
    if (chapter.number !== undefined && ch.label.show) {
      const ls = this.style(ch.label.style);
      const h = this.slotHeight(ls.size);
      const align = ch.title.align === "left" ? "left" : "center";
      items.push({ type: "box", height: h, draws: this.textLine(chapterLabel(chapter.number, lang, ch.label.format, ch.label.prefix), ls, this.env.width, align, h - (L - this.baseline)), breakAfter: NO_BREAK });
      items.push(strut(L));
    }
    const ts = this.style(ch.title);
    const set = this.setText(chapter.title, ts, this.env.width * (ch.title.align === "center" ? 0.85 : 1), ch.title.align === "center" ? "center" : "left");
    const h = this.slotHeight(ts.size);
    const left = ch.title.align === "center" ? this.env.width * 0.075 : 0;
    for (const box of this.lineBoxes(set, { left, blockId: chapter.id, height: h, baseline: h - (L - this.baseline), keepWithNext: true, keepTogether: true })) {
      box.start = undefined;
      items.push(box);
    }
    if (chapter.subtitle) {
      const ss: RunStyle = { ...ts, size: ts.size * 0.6, italic: !ts.italic, bold: false, caps: "none", uppercase: false, tracking: 0 };
      const sh = this.slotHeight(ss.size);
      const sub = this.setText([{ kind: "text", text: chapter.subtitle, style: {} }], ss, this.env.width * 0.85, ch.title.align === "center" ? "center" : "left");
      for (const box of this.lineBoxes(sub, { left, blockId: chapter.id, height: sh, baseline: sh - (L - this.baseline), keepWithNext: true, keepTogether: true })) {
        box.start = undefined;
        items.push(box);
      }
    }
    if (ch.ornament) {
      const os: RunStyle = { family: ch.ornament.family, size: ch.ornament.size };
      items.push({ type: "box", height: 2 * L, draws: this.textLine(ch.ornament.glyph, os, this.env.width, ch.title.align === "left" ? "left" : "center", L + os.size * 0.3), breakAfter: NO_BREAK });
    }
    items.push(strut(ch.spaceAfter * L));
    return items;
  }

  chapterBody(chapter: Chapter, opts: { dropCap: boolean }): VItem[] {
    const frame: Frame = { left: 0, width: this.env.width, base: this.base, nested: false };
    const state: ParaState = { noIndent: true, leadIn: this.env.theme.firstParagraph.leadInWords, dropCap: opts.dropCap && this.env.theme.firstParagraph.dropCap > 0 };
    return this.blocks(chapter.blocks, frame, state);
  }

  /** The endnotes for one chapter, under a subheading. */
  notesFor(chapter: Chapter, headingId: string, heading: string): VItem[] {
    const items: VItem[] = [];
    items.push(...this.heading([{ kind: "text", text: heading, style: {} }], 3, headingId, chapter.src, { left: 0, width: this.env.width, base: this.base, nested: false }));
    for (const note of chapter.notes) items.push(...this.note(note));
    return items;
  }

  /**
   * A footnote set for the foot of a page: its height and draws relative to its
   * top-left. A note longer than `maxLines` is cut there and reported.
   */
  footnote(note: Note, maxLines: number): { height: number; draws: Draw[]; cut: boolean } {
    const items = this.note(note);
    const draws: Draw[] = [];
    let y = 0;
    let lines = 0;
    let cut = false;
    for (const it of items) {
      if (it.type === "newpage") continue;
      if (it.type === "box") {
        if (lines >= maxLines) {
          cut = true;
          continue;
        }
        lines++;
        for (const d of it.draws) draws.push(offsetDraw(d, 0, y));
      }
      y += it.height;
    }
    return { height: y, draws, cut };
  }

  /**
   * The index as lines in one column: an entry, its pages, and its sub-entries
   * indented below, with wrapped lines hanging under the first.
   */
  indexItems(entries: IndexEntry[], width: number, seeWord: string): VItem[] {
    const items: VItem[] = [];
    const size = this.env.bodySize * 0.9;
    const base: RunStyle = { ...this.base, size };
    const hang = size * 1.2;
    const line = (text: string, indent: number, blockId: string) => {
      const set = this.env.setter.set([{ kind: "text", text, style: {} }], base, { width: width - indent - hang, align: "left", hyphenate: false });
      const boxes = this.lineBoxes(set, { left: indent + hang, blockId });
      // The first line hangs out to the indent; the rest sit one hang further in.
      if (boxes[0]) boxes[0].draws = boxes[0].draws.map((d) => (d.kind === "text" ? { ...d, x: d.x - hang } : d));
      boxes.forEach((b, i) => (b.breakAfter = i === boxes.length - 1 ? 0 : NO_BREAK));
      items.push(...boxes);
    };
    entries.forEach((e, n) => {
      const pages = formatPages(e.pages);
      const text = e.see && !pages ? `${e.main}, ${seeWord} ${e.see}` : pages ? `${e.main}, ${pages}` : e.main;
      line(text, 0, `index-${n}`);
      // An entry keeps its first line with its sub-entries.
      if (e.subs.length) (items[items.length - 1] as VBox).breakAfter = NO_BREAK;
      for (const s of e.subs) line(`${s.sub}, ${formatPages(s.pages)}`, hang, `index-${n}`);
    });
    return items;
  }

  private note(note: Note): VItem[] {
    const hang = this.env.bodySize * 1.8;
    const base: RunStyle = { ...this.base, size: this.env.bodySize * 0.92 };
    const frame: Frame = { left: hang, width: this.env.width - hang, base, nested: true };
    const items = this.blocks(note.blocks, frame, { noIndent: true, leadIn: 0, dropCap: false });
    const first = items.find((i): i is VBox => i.type === "box");
    if (first) {
      first.draws.push(...this.textLine(`${note.number}.`, { ...base, oldstyle: false }, hang - this.env.bodySize * 0.5, "right", this.baseline));
      first.start = { blockId: note.id, offset: 0 };
    }
    return items;
  }

  // ── Blocks ─────────────────────────────────────────────────────

  private blocks(blocks: Block[], frame: Frame, state: ParaState): VItem[] {
    const items: VItem[] = [];
    const L = this.L;
    const { theme } = this.env;
    blocks.forEach((b, idx) => {
      switch (b.kind) {
        case "paragraph": {
          if (theme.body.blockParagraphs && idx > 0) items.push({ type: "space", height: L * 0.5 });
          const indent = theme.body.blockParagraphs || state.noIndent ? 0 : theme.body.indent * this.env.bodySize;
          const set = this.env.setter.set(b.inlines, frame.base, {
            width: frame.width,
            align: theme.body.justify ? "justify" : "left",
            indent,
            hyphenate: this.env.hyphenate && theme.body.hyphenate,
            dropCap: state.dropCap && !frame.nested ? { lines: theme.firstParagraph.dropCap, family: theme.firstParagraph.dropCapFamily ?? theme.body.family, leading: L } : undefined,
            leadInWords: frame.nested ? 0 : state.leadIn,
            noteNumber: this.env.noteNumber,
          });
          items.push(...this.lineBoxes(set, { left: frame.left, blockId: b.id, src: b.src }));
          state.noIndent = false;
          state.leadIn = 0;
          state.dropCap = false;
          break;
        }
        case "heading": {
          items.push(...this.heading(b.inlines, Math.max(2, b.level), b.id, b.src, frame));
          state.noIndent = true;
          state.dropCap = false;
          break;
        }
        case "sceneBreak": {
          const glyph = this.env.sceneGlyph;
          const ss: RunStyle = { family: theme.sceneBreak.family, size: theme.sceneBreak.size };
          items.push({
            type: "box",
            height: 2 * L,
            draws: glyph ? this.textLine(glyph, ss, frame.width, "center", L + ss.size * 0.3, frame.left) : [],
            breakAfter: NO_BREAK,
            start: { blockId: b.id, offset: 0 },
            src: b.src,
          });
          state.noIndent = true;
          state.leadIn = theme.firstParagraph.leadInWords;
          break;
        }
        case "pageBreak":
          items.push({ type: "newpage" });
          state.noIndent = true;
          break;
        case "blockquote": {
          const indent = theme.blockquote.indent * this.env.bodySize;
          items.push({ type: "space", height: L * 0.5 });
          const inner: Frame = { left: frame.left + indent, width: frame.width - 2 * indent, base: theme.blockquote.italic ? { ...frame.base, italic: !frame.base.italic } : frame.base, nested: true };
          items.push(...this.blocks(b.blocks, inner, { noIndent: true, leadIn: 0, dropCap: false }));
          items.push({ type: "space", height: L * 0.5 });
          state.noIndent = true;
          break;
        }
        case "list": {
          const indent = this.env.bodySize * 1.8;
          if (!frame.nested) items.push({ type: "space", height: L * 0.5 });
          b.items.forEach((blocks, n) => {
            const inner: Frame = { left: frame.left + indent, width: frame.width - indent, base: frame.base, nested: true };
            const its = this.blocks(blocks, inner, { noIndent: true, leadIn: 0, dropCap: false });
            const first = its.find((i): i is VBox => i.type === "box");
            const marker = b.ordered ? `${b.start + n}.` : "•";
            if (first) first.draws.push(...this.textLine(marker, { ...frame.base, oldstyle: false }, indent - this.env.bodySize * 0.5, "right", this.baseline, frame.left));
            items.push(...its);
          });
          if (!frame.nested) items.push({ type: "space", height: L * 0.5 });
          state.noIndent = true;
          break;
        }
        case "code":
          items.push(...this.code(b.text, b.id, b.src, frame));
          state.noIndent = true;
          break;
        case "image":
          items.push(...this.image(b, frame));
          state.noIndent = true;
          break;
        case "table":
          items.push(...this.table(b, frame));
          state.noIndent = true;
          break;
      }
    });
    return items;
  }

  private heading(inlines: Inline[], level: number, id: string, src: SourceRef | undefined, frame: Frame): VItem[] {
    const ts = level <= 2 ? this.env.theme.heading2 : this.env.theme.heading3;
    const rs = this.style(ts);
    const h = this.slotHeight(rs.size);
    const set = this.setText(inlines, rs, frame.width, ts.align);
    const boxes = this.lineBoxes(set, { left: frame.left, blockId: id, src, height: h, baseline: h - (this.L - this.baseline), keepWithNext: true, keepTogether: true });
    return [{ type: "space", height: this.L }, ...boxes];
  }

  private code(text: string, id: string, src: SourceRef | undefined, frame: Frame): VItem[] {
    const L = this.L;
    const indent = this.env.bodySize;
    const style: RunStyle = { family: "inconsolata", size: this.env.bodySize * 0.85 };
    const charW = this.textWidth("0", style);
    const maxChars = Math.max(10, Math.floor((frame.width - indent) / charW));
    const items: VItem[] = [{ type: "space", height: L * 0.5 }];
    let offset = 0;
    for (const raw of text.replace(/\t/g, "    ").split("\n")) {
      let line = raw;
      let lineOffset = offset;
      do {
        const chunk = line.slice(0, maxChars);
        line = line.slice(maxChars);
        items.push({ type: "box", height: L, draws: chunk ? this.textLine(chunk, style, frame.width, "left", this.baseline, frame.left + indent) : [], breakAfter: 0, start: { blockId: id, offset: lineOffset }, src });
        lineOffset += chunk.length;
      } while (line.length);
      offset += raw.length + 1;
    }
    items.push({ type: "space", height: L * 0.5 });
    return items;
  }

  private image(b: Extract<Block, { kind: "image" }>, frame: Frame): VItem[] {
    const L = this.L;
    const asset = b.image.path ? this.env.images.get(b.image.path) : undefined;
    // Missing, unreadable and unsupported images were reported when the book was loaded.
    if (!asset) return [];
    // Fill the measure unless that would push resolution below 150 ppi.
    let w = Math.min(frame.width, (asset.width / 150) * 72);
    let h = (w * asset.height) / asset.width;
    const maxH = this.env.capacity * 0.75;
    if (h > maxH) {
      w *= maxH / h;
      h = maxH;
    }
    const ppi = asset.width / (w / 72);
    if (ppi < 300) {
      this.env.warn({ severity: "warning", message: `${b.image.target} prints at ${Math.round(ppi)} ppi; KDP recommends at least 300.`, src: b.src });
    }
    const draws: Draw[] = [];
    let captionH = 0;
    if (b.image.caption) {
      const cs: RunStyle = { ...frame.base, size: this.env.bodySize * 0.85, italic: !frame.base.italic };
      const set = this.setText([{ kind: "text", text: b.image.caption, style: {} }], cs, frame.width * 0.9, "center");
      captionH = set.lines.length * L;
      set.lines.forEach((_, k) => draws.push(...this.drawsFor(set, k, frame.left + frame.width * 0.05, 0)));
    }
    const total = Math.ceil((h + captionH + L * 0.6) / L) * L;
    const top = (total - h - captionH) / 2;
    draws.forEach((d, i) => {
      if (d.kind === "text") draws[i] = { ...d, y: d.y + top + h + this.baseline + L * 0.3 };
    });
    draws.unshift({ kind: "image", x: frame.left + (frame.width - w) / 2, y: top, w, h, path: asset.path, alt: b.image.alt });
    return [{ type: "box", height: total, draws, breakAfter: 0, start: { blockId: b.id, offset: 0 }, src: b.src }];
  }

  private table(b: Extract<Block, { kind: "table" }>, frame: Frame): VItem[] {
    const L = this.L;
    const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
    if (!cols) return [];
    const size = this.env.bodySize * 0.88;
    const body: RunStyle = { ...frame.base, size };
    const head: RunStyle = { ...body, bold: true };
    const pad = size * 0.6;
    const natural = new Array<number>(cols).fill(0);
    const measure = (cells: Inline[][], st: RunStyle) =>
      cells.forEach((c, i) => {
        const text = c.map((x) => (x.kind === "text" ? x.text : "")).join("");
        natural[i] = Math.max(natural[i], this.textWidth(text, st) + pad);
      });
    measure(b.header, head);
    b.rows.forEach((r) => measure(r, body));
    const sum = natural.reduce((a, c) => a + c, 0);
    const widths = sum <= frame.width ? natural.map((w) => w + (frame.width - sum) / cols) : natural.map((w) => Math.max(size * 3, (w / sum) * frame.width));
    const scale = frame.width / widths.reduce((a, c) => a + c, 0);
    for (let i = 0; i < cols; i++) widths[i] *= scale;
    const rowBox = (cells: Inline[][], st: RunStyle, isHead: boolean): VBox => {
      const sets = widths.map((w, i) => this.env.setter.set(cells[i] ?? [], st, { width: w - pad, align: b.align[i] ?? "left", noteNumber: this.env.noteNumber }));
      const lines = Math.max(1, ...sets.map((s) => s.lines.length));
      const draws: Draw[] = [];
      let x = frame.left;
      sets.forEach((s, i) => {
        s.lines.forEach((_, k) => draws.push(...this.drawsFor(s, k, x + pad / 2, this.baseline + k * L + L * 0.25)));
        x += widths[i];
      });
      const height = lines * L + L * 0.5;
      if (isHead) draws.push({ kind: "rule", x1: frame.left, y1: height - L * 0.1, x2: frame.left + frame.width, y2: height - L * 0.1, width: 0.6 });
      const notes = sets.flatMap((st) => st.lines.flatMap((l) => l.notes));
      return { type: "box", height, draws, breakAfter: isHead ? NO_BREAK : 0, start: { blockId: b.id, offset: 0 }, src: b.src, notes: notes.length ? notes : undefined };
    };
    const items: VItem[] = [{ type: "space", height: L * 0.5 }];
    const top: VBox = { type: "box", height: L * 0.25, draws: [{ kind: "rule", x1: frame.left, y1: L * 0.125, x2: frame.left + frame.width, y2: L * 0.125, width: 0.8 }], breakAfter: NO_BREAK };
    items.push(top);
    if (b.header.length) items.push(rowBox(b.header, head, true));
    b.rows.forEach((r, i) => {
      const box = rowBox(r, body, false);
      if (i === b.rows.length - 1) box.breakAfter = NO_BREAK;
      items.push(box);
    });
    items.push({ type: "box", height: L * 0.25, draws: [{ kind: "rule", x1: frame.left, y1: L * 0.125, x2: frame.left + frame.width, y2: L * 0.125, width: 0.8 }], breakAfter: 0 });
    items.push({ type: "space", height: L * 0.5 });
    return items;
  }
}
