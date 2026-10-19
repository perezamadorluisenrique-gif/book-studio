// Obsidian-flavoured Markdown → book blocks.
//
// Obsidian syntax (comments, wikilinks, embeds, highlights, block ids, footnotes,
// callouts) is rewritten before lexing, always keeping the line count intact so
// audit messages can point at the right line of the note.

import { Lexer, type Token, type Tokens } from "marked";
import { parseDocument } from "yaml";
import type { Block, BookWarning, ImageRef, Inline, InlineStyle, SourceRef } from "./model";
import { smartenInlines } from "./typography";

const NOTE_OPEN = "";
const NOTE_CLOSE = "";
const EMBED_OPEN = "";
const EMBED_CLOSE = "";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export interface ParseContext {
  file: string;
  lang: string;
  smart: boolean;
  nextId: () => string;
  /** Resolve a link target written in `file` to a vault path. */
  resolve: (target: string, from: string) => string | null;
  /** Read a note for transclusion (`![[Other note]]`). */
  readNote: (path: string) => Promise<string>;
  warnings: BookWarning[];
  depth?: number;
}

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  blocks: Block[];
  /** Footnote definitions by id, still as Markdown. */
  noteDefs: Map<string, { text: string; line: number }>;
}

export function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  // Control characters (pasted from elsewhere, say) would print as empty boxes.
  const src = text.replace(/\r\n?/g, "\n").replace(/[\v\f]/g, " ").replace(/[^\P{Cc}\t\n]/gu, "");
  const m = /^---\n([\s\S]*?)\n(---|\.\.\.)[ \t]*(\n|$)/.exec(src);
  if (!m) return { frontmatter: {}, body: src };
  let frontmatter: Record<string, unknown> = {};
  // Invalid YAML counts as no frontmatter; the lines still stay blank below.
  try {
    const doc = parseDocument(m[1], { uniqueKeys: false });
    // toJS() can still throw, for instance on an alias bomb.
    const parsed: unknown = doc.errors.length ? null : doc.toJS();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) frontmatter = parsed as Record<string, unknown>;
  } catch {
    // Keep the empty frontmatter.
  }
  const blankLines = "\n".repeat(m[0].split("\n").length - 1);
  return { frontmatter, body: blankLines + src.slice(m[0].length) };
}

/** Apply `fn` to the parts of a line outside inline code spans. */
function outsideCode(line: string, fn: (s: string) => string): string {
  const parts = line.split(/(`+[^`]*`+)/);
  return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join("");
}

let inlineNoteCounter = 0;

/** Rewrite Obsidian-only syntax into plain Markdown plus private-use placeholders. */
export function preprocess(body: string, noteDefs: Map<string, { text: string; line: number }>): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    if (fenceMatch && !inComment) {
      fence = fenceMatch[1];
      out.push(line);
      continue;
    }
    // %% comments %%, possibly spanning lines.
    let kept = "";
    let rest = line;
    while (rest.length) {
      const idx = rest.indexOf("%%");
      if (idx < 0) {
        if (!inComment) kept += rest;
        break;
      }
      if (!inComment) kept += rest.slice(0, idx);
      inComment = !inComment;
      rest = rest.slice(idx + 2);
    }
    line = kept;
    // Footnote definitions (with indented continuation lines).
    const def = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(line);
    if (def) {
      let text = def[2];
      let j = i + 1;
      while (j < lines.length && (/^( {2,}|\t)\S/.test(lines[j]) || (lines[j] === "" && /^( {4}|\t)\S/.test(lines[j + 1] ?? "")))) {
        text += "\n" + lines[j].replace(/^( {1,4}|\t)/, "");
        j++;
      }
      noteDefs.set(def[1], { text, line: i + 1 });
      for (let k = i; k < j; k++) out.push("");
      i = j - 1;
      continue;
    }
    line = outsideCode(line, (s) =>
      s
        // HTML comments on one line, except page-break markers.
        .replace(/<!--(?!\s*page-?break\s*-->)[\s\S]*?-->/gi, "")
        // Inline footnotes ^[text]
        .replace(/\^\[([^\]]+)\]/g, (_m, text: string) => {
          const id = `inline-${++inlineNoteCounter}`;
          noteDefs.set(id, { text, line: i + 1 });
          return NOTE_OPEN + id + NOTE_CLOSE;
        })
        .replace(/\[\^([^\]\s]+)\]/g, (_m, id: string) => NOTE_OPEN + id + NOTE_CLOSE)
        // Embeds: images become Markdown images, notes become transclusion placeholders.
        .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias: string | undefined) => {
          const t = target.trim();
          if (IMAGE_EXT.test(t.split("#")[0])) {
            const alt = alias && !/^\d+(x\d+)?$/.test(alias.trim()) ? alias.trim() : "";
            return `![${alt.replace(/[[\]]/g, "")}](<${t}>)`;
          }
          return EMBED_OPEN + t + EMBED_CLOSE;
        })
        // Wikilinks show their alias, or the note (or heading) name.
        .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias: string | undefined) => {
          if (alias && alias.trim()) return alias.trim();
          const [note, heading] = target.split("#");
          const name = note.split("/").pop()?.replace(/\.md$/i, "") ?? note;
          return heading && !name ? heading : name;
        })
        // ==highlights== are drafting marks, not book formatting.
        .replace(/==([^=\n]+)==/g, "$1")
        // Block ids at the end of a line.
        .replace(/\s\^[A-Za-z0-9-]+\s*$/, ""),
    );
    out.push(line);
  }
  return out.join("\n");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  shy: "­",
  copy: "©",
  reg: "®",
  trade: "™",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function textInlines(text: string, style: InlineStyle): Inline[] {
  const out: Inline[] = [];
  const parts = decodeEntities(text).split(new RegExp(`${NOTE_OPEN}([^${NOTE_CLOSE}]+)${NOTE_CLOSE}`));
  parts.forEach((p, i) => {
    if (i % 2 === 1) out.push({ kind: "noteRef", noteId: p });
    else if (p) out.push({ kind: "text", text: p, style });
  });
  return out;
}

function convertInline(tokens: Token[] | undefined, style: InlineStyle, out: Inline[]): void {
  if (!tokens) return;
  for (const t of tokens) {
    switch (t.type) {
      case "text":
      case "escape": {
        const tt = t as Tokens.Text;
        if (tt.tokens && tt.tokens.length) convertInline(tt.tokens, style, out);
        else out.push(...textInlines(tt.text, style));
        break;
      }
      case "strong":
        convertInline((t as Tokens.Strong).tokens, { ...style, bold: true }, out);
        break;
      case "em":
        convertInline((t as Tokens.Em).tokens, { ...style, italic: !style.italic }, out);
        break;
      case "del":
        convertInline((t as Tokens.Del).tokens, { ...style, strike: true }, out);
        break;
      case "codespan":
        out.push({ kind: "text", text: decodeEntities((t as Tokens.Codespan).text), style: { ...style, code: true } });
        break;
      case "br":
        out.push({ kind: "break" });
        break;
      case "link": {
        const l = t as Tokens.Link;
        convertInline(l.tokens, { ...style, href: l.href }, out);
        break;
      }
      case "image":
        // Inline images inside running text are not supported in print; keep the alt text.
        out.push(...textInlines((t as Tokens.Image).text, style));
        break;
      case "html": {
        const h = (t as Tokens.HTML).text.trim().toLowerCase();
        if (/^<br\s*\/?>$/.test(h)) out.push({ kind: "break" });
        else if (h === "<sup>") style = { ...style, sup: true };
        else if (h === "</sup>") style = { ...style, sup: false };
        else if (h === "<sub>") style = { ...style, sub: true };
        else if (h === "</sub>") style = { ...style, sub: false };
        else if (h === "<i>" || h === "<em>" || h === "<cite>") style = { ...style, italic: true };
        else if (h === "</i>" || h === "</em>" || h === "</cite>") style = { ...style, italic: false };
        else if (h === "<b>" || h === "<strong>") style = { ...style, bold: true };
        else if (h === "</b>" || h === "</strong>") style = { ...style, bold: false };
        else if (/^<span[^>]*(small-?caps|class="sc")/.test(h)) style = { ...style, smallCaps: true };
        else if (h === "</span>") style = { ...style, smallCaps: false };
        break;
      }
      default: {
        const anyT = t as { tokens?: Token[]; text?: string };
        if (anyT.tokens) convertInline(anyT.tokens, style, out);
        else if (anyT.text) out.push(...textInlines(anyT.text, style));
      }
    }
  }
}

export function inlinesOf(tokens: Token[] | undefined): Inline[] {
  const out: Inline[] = [];
  convertInline(tokens, {}, out);
  // Merge adjacent text runs with identical style.
  const merged: Inline[] = [];
  for (const i of out) {
    const last = merged[merged.length - 1];
    if (i.kind === "text" && last?.kind === "text" && JSON.stringify(last.style) === JSON.stringify(i.style)) {
      merged[merged.length - 1] = { ...last, text: last.text + i.text };
    } else merged.push(i);
  }
  return merged;
}

const SCENE_BREAK_TEXT = /^\s*(\*\s*){3,}$|^\s*[#⁂❦❧☙◆§~]\s*$|^\s*(\*|#|~)(\s+\2){2,}\s*$/;
const PAGE_BREAK_TEXT = /^\s*(\\pagebreak|\\newpage|<!--\s*page-?break\s*-->|<div[^>]*page-break-(before|after):\s*always[^>]*>\s*<\/div>)\s*$/i;

function plain(inlines: Inline[]): string {
  return inlines.map((i) => (i.kind === "text" ? i.text : i.kind === "break" ? "\n" : "")).join("");
}

function makeImage(tok: Tokens.Image, ctx: ParseContext): ImageRef {
  let target = tok.href.trim();
  try {
    target = decodeURI(target);
  } catch {
    // Keep the raw href.
  }
  const alt = decodeEntities(tok.text ?? "").trim();
  const decorative = /^(decorative|-)$/i.test(alt);
  const external = /^[a-z]+:\/\//i.test(target);
  const path = external ? "" : ctx.resolve(target.split("#")[0], ctx.file) ?? "";
  return {
    path,
    target,
    alt: decorative ? "" : alt,
    caption: tok.title ? decodeEntities(tok.title) : undefined,
    decorative,
  };
}

async function convertBlocks(tokens: Token[], ctx: ParseContext, baseLine: number): Promise<Block[]> {
  const blocks: Block[] = [];
  let line = baseLine;
  for (const t of tokens) {
    const src: SourceRef = { file: ctx.file, line };
    const raw = (t as { raw?: string }).raw ?? "";
    await convertBlock(t, ctx, src, blocks);
    line += (raw.match(/\n/g) ?? []).length;
  }
  return blocks;
}

async function convertBlock(t: Token, ctx: ParseContext, src: SourceRef, blocks: Block[]): Promise<void> {
  switch (t.type) {
    case "space":
    case "def":
      return;
    case "hr":
      blocks.push({ kind: "sceneBreak", id: ctx.nextId(), src });
      return;
    case "heading": {
      const h = t as Tokens.Heading;
      const inlines = inlinesOf(h.tokens);
      if (!plain(inlines).trim() || SCENE_BREAK_TEXT.test(h.raw.trim())) {
        // A lone "#" or "# # #" line is a scene break in many manuscripts.
        blocks.push({ kind: "sceneBreak", id: ctx.nextId(), src });
        return;
      }
      blocks.push({ kind: "heading", id: ctx.nextId(), level: h.depth, inlines, src });
      return;
    }
    case "code": {
      const c = t as Tokens.Code;
      blocks.push({ kind: "code", id: ctx.nextId(), text: c.text, src });
      return;
    }
    case "html": {
      const h = (t as Tokens.HTML).text;
      if (PAGE_BREAK_TEXT.test(h.trim())) blocks.push({ kind: "pageBreak", id: ctx.nextId(), src });
      else if (h.trim()) ctx.warnings.push({ message: "Raw HTML block skipped (only page-break markers are supported).", src });
      return;
    }
    case "blockquote": {
      const bq = t as Tokens.Blockquote;
      const inner = await convertBlocks(bq.tokens, ctx, src.line);
      // Obsidian callouts: drop the [!type] marker, keep any title as a bold line.
      const first = inner[0];
      if (first?.kind === "paragraph" && first.inlines[0]?.kind === "text") {
        const lead = first.inlines[0];
        const m = /^\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/.exec(lead.text);
        if (m) {
          const remaining = lead.text.slice(m[0].length);
          const restInlines = [...(remaining ? [{ ...lead, text: remaining }] : []), ...first.inlines.slice(1)];
          const replacement: Block[] = [];
          if (m[2].trim()) replacement.push({ kind: "paragraph", id: ctx.nextId(), inlines: [{ kind: "text", text: m[2].trim(), style: { bold: true } }], src });
          if (plain(restInlines).trim()) replacement.push({ ...first, inlines: restInlines.filter((x, i) => !(i === 0 && x.kind === "break")) });
          inner.splice(0, 1, ...replacement);
        }
      }
      blocks.push({ kind: "blockquote", id: ctx.nextId(), blocks: inner, src });
      return;
    }
    case "list": {
      const l = t as Tokens.List;
      const items: Block[][] = [];
      let line = src.line;
      for (const item of l.items) {
        items.push(await convertBlocks(item.tokens, ctx, line));
        line += (item.raw.match(/\n/g) ?? []).length;
      }
      blocks.push({ kind: "list", id: ctx.nextId(), ordered: l.ordered, start: typeof l.start === "number" ? l.start : 1, items, src });
      return;
    }
    case "table": {
      const tb = t as Tokens.Table;
      blocks.push({
        kind: "table",
        id: ctx.nextId(),
        header: tb.header.map((c) => inlinesOf(c.tokens)),
        rows: tb.rows.map((r) => r.map((c) => inlinesOf(c.tokens))),
        align: tb.align,
        src,
      });
      return;
    }
    case "paragraph":
    case "text": {
      const p = t as Tokens.Paragraph;
      const raw = p.text.trim();
      if (PAGE_BREAK_TEXT.test(raw)) {
        blocks.push({ kind: "pageBreak", id: ctx.nextId(), src });
        return;
      }
      if (SCENE_BREAK_TEXT.test(raw)) {
        blocks.push({ kind: "sceneBreak", id: ctx.nextId(), src });
        return;
      }
      const embed = new RegExp(`^${EMBED_OPEN}([^${EMBED_CLOSE}]+)${EMBED_CLOSE}$`).exec(raw);
      if (embed) {
        await transclude(embed[1], ctx, src, blocks);
        return;
      }
      const toks = (p.tokens ?? []).filter((x) => !(x.type === "text" && !(x as Tokens.Text).text.trim()));
      if (toks.length === 1 && toks[0].type === "image") {
        const image = makeImage(toks[0] as Tokens.Image, ctx);
        if (!image.path) ctx.warnings.push({ message: `Image not found: ${image.target}`, src });
        blocks.push({ kind: "image", id: ctx.nextId(), image, src });
        return;
      }
      if (toks.some((x) => x.type === "image")) {
        ctx.warnings.push({ message: "Images inside a line of text are not supported; put the image on its own line.", src });
      }
      const inlines = inlinesOf(p.tokens);
      if (!plain(inlines).trim() && !inlines.some((i) => i.kind === "noteRef")) return;
      blocks.push({ kind: "paragraph", id: ctx.nextId(), inlines, src });
      return;
    }
    default:
      return;
  }
}

async function transclude(target: string, ctx: ParseContext, src: SourceRef, blocks: Block[]): Promise<void> {
  const depth = ctx.depth ?? 0;
  const [note, heading] = target.split("#");
  const path = ctx.resolve(note, ctx.file);
  if (!path) {
    ctx.warnings.push({ message: `Embedded note not found: ${target}`, src });
    return;
  }
  if (depth >= 4) {
    ctx.warnings.push({ message: `Embeds nested too deeply at ${target}`, src });
    return;
  }
  const text = await ctx.readNote(path);
  const parsed = await parseMarkdown(text, { ...ctx, file: path, depth: depth + 1 });
  let inner = parsed.blocks;
  if (heading) {
    const start = inner.findIndex((b) => b.kind === "heading" && plain(b.inlines).trim().toLowerCase() === heading.trim().toLowerCase());
    if (start < 0) {
      ctx.warnings.push({ message: `Heading "${heading}" not found in ${note}`, src });
      return;
    }
    const level = (inner[start] as { level: number }).level;
    let end = inner.findIndex((b, i) => i > start && b.kind === "heading" && b.level <= level);
    if (end < 0) end = inner.length;
    inner = inner.slice(start + 1, end);
  }
  blocks.push(...inner);
}

function smartenBlocks(blocks: Block[], lang: string): void {
  for (const b of blocks) {
    if (b.kind === "paragraph" || b.kind === "heading") b.inlines = smartenInlines(b.inlines, lang);
    else if (b.kind === "blockquote") smartenBlocks(b.blocks, lang);
    else if (b.kind === "list") b.items.forEach((it) => smartenBlocks(it, lang));
    else if (b.kind === "table") {
      b.header = b.header.map((c) => smartenInlines(c, lang));
      b.rows = b.rows.map((r) => r.map((c) => smartenInlines(c, lang)));
    } else if (b.kind === "image") {
      b.image.caption = b.image.caption ? plain(smartenInlines([{ kind: "text", text: b.image.caption, style: {} }], lang)) : undefined;
    }
  }
}

export async function parseMarkdown(text: string, ctx: ParseContext): Promise<ParsedNote> {
  const { frontmatter, body } = splitFrontmatter(text);
  const noteDefs = new Map<string, { text: string; line: number }>();
  const md = preprocess(body, noteDefs);
  const tokens = new Lexer({ gfm: true, breaks: false }).lex(md);
  const blocks = await convertBlocks(tokens, ctx, 1);
  if (ctx.smart) smartenBlocks(blocks, ctx.lang);
  return { frontmatter, blocks, noteDefs };
}

/** Parse a footnote definition (Markdown) into blocks. */
export async function parseNoteText(text: string, ctx: ParseContext, line: number): Promise<Block[]> {
  const tokens = new Lexer({ gfm: true }).lex(text);
  const blocks = await convertBlocks(tokens, ctx, line);
  if (ctx.smart) smartenBlocks(blocks, ctx.lang);
  return blocks;
}

export { plain as plainText };
