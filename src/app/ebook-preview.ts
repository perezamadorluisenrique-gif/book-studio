// The Ebook tab: one chapter of the EPUB as a reader would draw it, in a frame of a 6-inch e-ink reader, a phone or a
// tablet. It reads the same files `writeEpub` zips (see `epubParts`), puts the book's CSS, fonts and pictures inside the
// page as data, and shows it in an iframe that cannot run scripts, cannot reach the network and is paged with CSS columns.
// The picture is an approximation: each ebook reader draws a book its own way.

import { epubParts } from "../engine/epub";
import type { FontSet } from "../engine/fonts";
import { append, clear, h, select } from "./dom";
import type { Built } from "./pipeline";
import { t } from "./ui-i18n";

export type EpubFiles = Map<string, string | Uint8Array>;

export interface PreviewDoc {
  /** Path inside the EPUB, such as "EPUB/text/chapter-1.xhtml". */
  path: string;
  title: string;
}

export type FrameId = "eink" | "phone" | "tablet";

/** The screens, in CSS pixels. No brand and no picture of a real device: a frame is a rounded rectangle. */
export const FRAMES: Record<FrameId, { w: number; h: number }> = {
  eink: { w: 300, h: 400 },
  phone: { w: 260, h: 540 },
  tablet: { w: 420, h: 560 },
};

/** The three reader text sizes, as a share of the book's own size. */
export const READER_SIZES = [90, 100, 125] as const;

/** Nothing may load from anywhere but the page itself: no scripts, no frames, no network. */
export const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ttf: "font/ttf" };

function toText(v: string | Uint8Array | undefined): string {
  return typeof v === "string" ? v : v ? new TextDecoder().decode(v) : "";
}

function dataUrl(bytes: Uint8Array | string, ext: string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `data:${MIME[ext] ?? "application/octet-stream"};base64,${btoa(bin)}`;
}

const decode = (s: string): string => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The reading documents of the EPUB in spine order, without the navigation page. */
export function previewDocs(files: EpubFiles): PreviewDoc[] {
  const opf = toText(files.get("EPUB/package.opf"));
  const hrefs = new Map<string, string>();
  for (const m of opf.matchAll(/<item\s[^>]*>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[0])?.[1];
    const href = /\shref="([^"]+)"/.exec(m[0])?.[1];
    const props = /\sproperties="([^"]+)"/.exec(m[0])?.[1] ?? "";
    if (id && href && /xhtml/.test(m[0]) && !/\bnav\b/.test(props)) hrefs.set(id, href);
  }
  const docs: PreviewDoc[] = [];
  for (const m of opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)) {
    const href = hrefs.get(m[1]);
    if (!href) continue;
    const path = `EPUB/${href}`;
    const xhtml = toText(files.get(path));
    const title = /<title>([\s\S]*?)<\/title>/.exec(xhtml)?.[1] ?? href;
    docs.push({ path, title: decode(title.trim()) || href });
  }
  return docs;
}

export interface SrcdocOptions {
  /** Reader text size as a percentage (see READER_SIZES). */
  size: number;
  dark: boolean;
  frame: FrameId;
}

const PAD = 18;

/** The page the iframe shows: one chapter with the book's CSS, fonts and pictures inside it, set in columns of one screen. */
export function chapterSrcdoc(files: EpubFiles, docPath: string, opts: SrcdocOptions): string {
  const xhtml = toText(files.get(docPath));
  const lang = /\sxml:lang="([^"]*)"|\slang="([^"]*)"/.exec(xhtml);
  const body = /<body([^>]*)>([\s\S]*)<\/body>/.exec(xhtml);
  const base = docPath.replace(/[^/]*$/, "");
  const resolve = (ref: string): string => {
    const parts = (base + ref).split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (p === "..") out.pop();
      else if (p && p !== ".") out.push(p);
    }
    return out.join("/");
  };
  const inline = (text: string, from: string): string =>
    text.replace(/(src="|url\(")([^"]+)(")/g, (all, open: string, ref: string, close: string) => {
      if (/^(data:|#)/.test(ref)) return all;
      const file = files.get(resolve(from === "css" ? `../${ref.replace(/^\.\.\//, "")}` : ref));
      const ext = /\.([a-z0-9]+)$/i.exec(ref)?.[1]?.toLowerCase() ?? "";
      return file === undefined ? `${open}${close}` : `${open}${dataUrl(file, ext)}${close}`;
    });
  // The book's CSS refers to fonts as "../fonts/x.ttf", relative to css/; pictures in the text as "../images/x.jpg".
  const css = toText(files.get("EPUB/css/book.css")).replace(/url\("\.\.\/([^"]+)"\)/g, (all, ref: string) => {
    const file = files.get(`EPUB/${ref}`);
    return file === undefined ? all : `url("${dataUrl(file, /\.([a-z0-9]+)$/i.exec(ref)?.[1]?.toLowerCase() ?? "")}")`;
  });
  const { w, h: height } = FRAMES[opts.frame];
  const colour = opts.dark ? "html { background: #15171a; color: #e8e6e1; } a { color: inherit; }" : "html { background: #ffffff; }";
  const reader = [
    `html { font-size: ${opts.size}%; overflow: hidden; height: 100%; margin: 0; }`,
    `body { margin: 0; padding: 0; overflow: visible; }`,
    `#page { box-sizing: border-box; height: ${height - 2 * PAD}px; margin: ${PAD}px; column-width: ${w - 2 * PAD}px; column-gap: ${2 * PAD}px; column-fill: auto; }`,
    `img, svg { max-width: 100%; max-height: ${height - 2 * PAD - 8}px; }`,
    colour,
  ].join("\n");
  // Links to other files (notes, the next chapter) would load the app inside the frame; they point nowhere here.
  const inner = body ? inline(body[2], "text").replace(/href="(?!#)[^"]*"/g, 'href="#"') : "";
  const attrs = body ? body[1] : "";
  return `<!doctype html><html lang="${lang?.[1] ?? lang?.[2] ?? "en"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><title></title><style>${css}</style><style>${reader}</style></head><body${attrs}><div id="page">${inner}</div></body></html>`;
}

export interface EbookContext {
  built(): Built | null;
  fonts(): Promise<FontSet>;
}

export class EbookPanel {
  private active = false;
  private files: EpubFiles | null = null;
  private filesFor: Built | null = null;
  private docs: PreviewDoc[] = [];
  private doc = "";
  private frame: FrameId = "eink";
  private size = 1;
  private dark = false;
  private pageIndex = 0;
  private pageCount = 1;
  private gen = 0;
  private iframe: HTMLIFrameElement | null = null;
  private indicator = h("span", { cls: "bs-ebook-page", attr: { role: "status", "aria-live": "polite" } });
  private screen = h("div", { cls: "bs-ebook-stage" });
  private prev = h("button", { text: t("eb.prev"), attr: { type: "button" } });
  private next = h("button", { text: t("eb.next"), attr: { type: "button" } });

  constructor(
    private panel: HTMLElement,
    private ctx: EbookContext,
  ) {
    this.prev.addEventListener("click", () => this.go(-1));
    this.next.addEventListener("click", () => this.go(1));
  }

  /** The tab is shown or hidden; the chapter is only built while it is shown. */
  setActive(on: boolean): void {
    this.active = on;
    if (on) void this.load();
  }

  render(): void {
    const built = this.ctx.built();
    clear(this.panel);
    if (!built) return;
    if (this.filesFor !== built) {
      this.files = null;
      this.docs = [];
    }
    const chapters = select([], "", { attr: { "aria-label": t("eb.chapter") }, on: { change: () => this.choose(chapters.value) } });
    this.chapterSelect = chapters;
    const frame = select(
      [
        { value: "eink", label: t("eb.frame.eink") },
        { value: "phone", label: t("eb.frame.phone") },
        { value: "tablet", label: t("eb.frame.tablet") },
      ],
      this.frame,
      { attr: { "aria-label": t("eb.frame") }, on: { change: () => this.setFrame(frame.value as FrameId) } },
    );
    const size = select(
      [t("eb.size.small"), t("eb.size.medium"), t("eb.size.large")].map((label, i) => ({ value: String(i), label })),
      String(this.size),
      { attr: { "aria-label": t("eb.size") }, on: { change: () => this.setSize(Number(size.value)) } },
    );
    const dark = h("input", { attr: { type: "checkbox", checked: this.dark } });
    dark.addEventListener("change", () => this.setDark(dark.checked));
    append(
      this.panel,
      h("div", { cls: "bs-bar" }, h("label", { cls: "bs-field" }, h("span", { text: t("eb.chapter") }), chapters), h("label", { cls: "bs-field" }, h("span", { text: t("eb.frame") }), frame), h("label", { cls: "bs-field" }, h("span", { text: t("eb.size") }), size), h("label", { cls: "bs-check" }, dark, t("eb.dark"))),
      h("div", { cls: "bs-bar" }, this.prev, this.indicator, this.next),
      this.screen,
      h("p", { cls: "bs-ebook-note", text: t("eb.note") }),
    );
    if (this.active) void this.load();
  }

  private chapterSelect: HTMLSelectElement | null = null;

  private async load(): Promise<void> {
    const built = this.ctx.built();
    if (!built) return;
    const gen = ++this.gen;
    if (this.filesFor !== built || !this.files) {
      const fonts = await this.ctx.fonts();
      const files = await epubParts(built.book, { accessiblePack: false, fonts, modified: new Date() });
      if (gen !== this.gen) return;
      this.files = files;
      this.filesFor = built;
      this.docs = previewDocs(files);
    }
    if (!this.docs.some((d) => d.path === this.doc)) {
      // The first document with a real run of text (not the title or copyright page); else the first one.
      const files = this.files;
      this.doc = this.docs.find((d) => toText(files.get(d.path)).length > 2500)?.path ?? this.docs[0]?.path ?? "";
    }
    const sel = this.chapterSelect;
    if (sel) {
      clear(sel);
      for (const d of this.docs) sel.append(h("option", { attr: { value: d.path, selected: d.path === this.doc } }, d.title));
      sel.value = this.doc;
    }
    this.show();
  }

  private choose(path: string): void {
    this.doc = path;
    this.pageIndex = 0;
    this.show();
  }

  private setFrame(frame: FrameId): void {
    this.frame = frame;
    this.pageIndex = 0;
    this.show();
  }

  private setSize(i: number): void {
    this.size = i;
    this.pageIndex = 0;
    this.show();
  }

  private setDark(on: boolean): void {
    this.dark = on;
    this.show();
  }

  private show(): void {
    if (!this.files || !this.doc) return;
    const { w, h: height } = FRAMES[this.frame];
    const frame = h("div", { cls: `bs-ebook-frame is-${this.frame}`, attr: { role: "group", "aria-label": t(`eb.frame.${this.frame}`) } });
    frame.style.setProperty("--eb-w", `${w}px`);
    frame.style.setProperty("--eb-h", `${height}px`);
    // Scripts stay off (no allow-scripts); allow-same-origin only lets this page read the page count of its own, script-free document.
    const iframe = h("iframe", { cls: "bs-ebook-screen", attr: { sandbox: "allow-same-origin", title: t("eb.screenTitle"), width: w, height } });
    iframe.srcdoc = chapterSrcdoc(this.files, this.doc, { size: READER_SIZES[this.size], dark: this.dark, frame: this.frame });
    iframe.addEventListener("load", () => this.measure(iframe));
    frame.append(iframe);
    clear(this.screen);
    this.screen.append(frame);
    this.iframe = iframe;
  }

  private measure(iframe: HTMLIFrameElement): void {
    const settle = () => {
      if (iframe !== this.iframe) return;
      const doc = iframe.contentDocument;
      const root = doc?.scrollingElement;
      if (!doc || !root) return;
      this.pageCount = Math.max(1, Math.round(root.scrollWidth / FRAMES[this.frame].w));
      this.pageIndex = Math.min(this.pageIndex, this.pageCount - 1);
      this.turn();
    };
    settle();
    void iframe.contentDocument?.fonts?.ready.then(settle);
  }

  private go(step: number): void {
    this.pageIndex = Math.min(this.pageCount - 1, Math.max(0, this.pageIndex + step));
    this.turn();
  }

  private turn(): void {
    const root = this.iframe?.contentDocument?.scrollingElement;
    if (root) root.scrollLeft = this.pageIndex * FRAMES[this.frame].w;
    this.indicator.textContent = t("eb.page", { n: this.pageIndex + 1, total: this.pageCount });
    this.prev.disabled = this.pageIndex === 0;
    this.next.disabled = this.pageIndex >= this.pageCount - 1;
  }
}
