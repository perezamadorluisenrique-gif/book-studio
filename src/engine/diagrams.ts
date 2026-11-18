// Mermaid diagrams: a ```mermaid code block becomes a picture in print and in the EPUB.
// The engine stays pure: the host draws the diagram (Obsidian's own Mermaid, or the web
// app's lazily loaded copy) and hands back a PNG. Everything here is plain logic.

import type { Block, BookWarning, Chapter, ImageAsset } from "./model";

/** A diagram the host has drawn: a PNG of `width` × `height` CSS pixels, at `scale` pixels per CSS pixel. */
export interface RenderedDiagram {
  png: Uint8Array;
  width: number;
  height: number;
  scale: number;
}

export interface DiagramRequest {
  /** The widest the diagram can ever print, in inches (the trim width): it is drawn sharp enough for that. */
  maxPrintInches: number;
}

/** Draws one diagram. Rejects with the parser's message when the code is not a valid diagram. */
export type DiagramRenderer = (code: string, request: DiagramRequest) => Promise<RenderedDiagram>;

/** Pixels per inch the PNG reaches at the largest size it can print. KDP asks for 300. */
export const DIAGRAM_PPI = 300;
/** iOS refuses canvases over 16,777,216 pixels; stay under it. */
export const MAX_DIAGRAM_PIXELS = 16_000_000;
const MAX_SIDE = 16_384;
/** A CSS pixel is 1/96 inch. */
const CSS_PPI = 96;

export function isDiagram(lang: string | undefined): boolean {
  return (lang ?? "").trim().split(/\s+/)[0].toLowerCase() === "mermaid";
}

/** Mermaid's accessibility lines: `accTitle: …`, `accDescr: …` or `accDescr { … }` over several lines. */
export function diagramText(code: string): { title?: string; description?: string } {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const title = /^[ \t]*accTitle[ \t]*:[ \t]*(.+)$/m.exec(code)?.[1];
  const line = /^[ \t]*accDescr[ \t]*:[ \t]*(.+)$/m.exec(code)?.[1];
  const block = /^[ \t]*accDescr[ \t]*\{([^}]*)\}/m.exec(code)?.[1];
  const description = line ?? block;
  return { ...(title && clean(title) ? { title: clean(title) } : {}), ...(description && clean(description) ? { description: clean(description) } : {}) };
}

/** The text alternative for the picture: the title, then the description. Empty when the diagram has neither. */
export function diagramAlt(code: string): string {
  const { title, description } = diagramText(code);
  if (title && description) return `${title}${/[.!?:]$/.test(title) ? "" : "."} ${description}`;
  return title ?? description ?? "";
}

// A print look for every diagram: Mermaid's black-and-white "neutral" theme, and labels as SVG text
// (HTML labels can't be drawn onto a canvas). A diagram that sets its own `init` still wins.
const PRINT_INIT = `%%{init: {"theme": "neutral", "htmlLabels": false, "flowchart": {"htmlLabels": false}, "themeVariables": {"fontFamily": "Helvetica, Arial, sans-serif", "background": "#ffffff"}}}%%`;

/** The code as handed to Mermaid: the print settings go first, after any front matter. */
export function forPrint(code: string): string {
  const fm = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(code);
  return fm ? `${fm[0]}${fm[0].endsWith("\n") ? "" : "\n"}${PRINT_INIT}\n${code.slice(fm[0].length)}` : `${PRINT_INIT}\n${code}`;
}

/** Pixels per CSS pixel: sharp enough at the widest size the diagram can print, within what a canvas allows. */
export function diagramScale(width: number, height: number, maxPrintInches: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const printInches = Math.min(width / CSS_PPI, maxPrintInches);
  // 5% over the target, so rounding never lands a figure just under 300 ppi.
  let scale = Math.max(1, (printInches * DIAGRAM_PPI * 1.05) / width);
  scale = Math.min(scale, Math.sqrt(MAX_DIAGRAM_PIXELS / (width * height)), MAX_SIDE / Math.max(width, height));
  return Math.floor(scale * 1000) / 1000;
}

/** Width and height of an SVG in CSS pixels, from its viewBox (Mermaid sets one) or its width/height. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const vb = /\bviewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)\s*["']/.exec(root);
  if (vb) {
    const width = Number(vb[3]);
    const height = Number(vb[4]);
    if (width > 0 && height > 0) return { width, height };
  }
  const num = (name: string) => Number(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`).exec(root)?.[1]);
  const width = num("width");
  const height = num("height");
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The SVG with a fixed pixel size on its root, so an <img> draws it at that size (Mermaid writes width="100%"). */
export function sizedSvg(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (root) => {
    const rest = root
      .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, "")
      .replace(/^<svg\b/i, "");
    return `<svg width="${width}" height="${height}"${rest}`;
  });
}

/** Short and on one line, for the Problems list. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Mermaid's parse errors start "Parse error on line N:", then the line, a caret and what it expected.
  const text = lines.filter((l) => !/^-*\^$/.test(l)).join(" ");
  return text.length > 300 ? `${text.slice(0, 299)}…` : text || "unknown error";
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

type CodeBlock = Extract<Block, { kind: "code" }>;

function collect(blocks: Block[], out: { list: Block[]; index: number; block: CodeBlock }[]): void {
  blocks.forEach((b, index) => {
    if (b.kind === "code" && isDiagram(b.lang)) out.push({ list: blocks, index, block: b });
    else if (b.kind === "blockquote") collect(b.blocks, out);
    else if (b.kind === "list") b.items.forEach((it) => collect(it, out));
  });
}

/**
 * Turn every ```mermaid block into a picture. A diagram that fails to draw stays as code, with a warning
 * that carries Mermaid's message; a diagram with no accTitle/accDescr gets a warning asking for one.
 */
export async function renderDiagrams(chapters: Chapter[], render: DiagramRenderer, request: DiagramRequest, images: Map<string, ImageAsset>, warnings: BookWarning[]): Promise<void> {
  const found: { list: Block[]; index: number; block: CodeBlock }[] = [];
  for (const c of chapters) {
    collect(c.blocks, found);
    c.notes.forEach((n) => collect(n.blocks, found));
  }
  const done = new Map<string, Promise<RenderedDiagram>>();
  for (const { list, index, block } of found) {
    const path = `diagram:mermaid-${hash(`${request.maxPrintInches}\n${block.text}`)}.png`;
    let job = done.get(path);
    if (!job) done.set(path, (job = render(block.text, request)));
    let drawn: RenderedDiagram;
    try {
      drawn = await job;
      if (!(drawn.width > 0 && drawn.height > 0 && drawn.scale > 0 && drawn.png.length)) throw new Error("the diagram came out empty");
    } catch (e) {
      warnings.push({ message: `Mermaid diagram could not be drawn, so it prints as code: ${errorText(e)}`, src: block.src });
      continue;
    }
    if (!images.has(path)) {
      images.set(path, {
        path,
        bytes: drawn.png,
        mime: "image/png",
        width: Math.round(drawn.width * drawn.scale),
        height: Math.round(drawn.height * drawn.scale),
        ppi: CSS_PPI * drawn.scale,
      });
    }
    const alt = diagramAlt(block.text);
    if (!alt) {
      warnings.push({ message: "Mermaid diagram has no description for screen readers. Add an accTitle: line inside the diagram (and accDescr: for more detail).", src: block.src });
    }
    list[index] = { kind: "image", id: block.id, image: { path, target: "Mermaid diagram", alt, decorative: false, diagram: true }, src: block.src };
  }
}
