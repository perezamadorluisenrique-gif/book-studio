// The studio panel: pick a book, choose theme and trim, see every page as it
// will print, review problems and accessibility, and export. The Obsidian view
// and the web app both mount it; everything host-specific goes through StudioHost.

import { FREE_EDITION, PRO_PREVIEW } from "../config";
import { hasFeature, PRO_FEATURES, themeAllowed, trimAllowed, type ExportBlocker, type Plan } from "../engine/entitlements";
import { FontSet } from "../engine/fonts";
import type { BookSettings, SourceRef } from "../engine/model";
import { THEMES } from "../engine/themes";
import { TRIMS } from "../engine/trims";
import { PagePainter } from "../preview/canvas";
import { append, clear, h, nextFrame, select } from "./dom";
import type { BookChoice, StudioHost } from "./host";
import type { LicenseManager } from "./license-manager";
import { KdpPanel } from "./kdp-panel";
import { buildBook, ebookBlockers, exportEpub, exportPdf, exportReport, pdfBlockers, spineWidth, type Built, type EpubChoices } from "./pipeline";

type Tab = "preview" | "problems" | "kdp" | "accessibility";
type Zoom = "page" | "fit" | "0.5" | "0.75" | "1" | "1.5" | "2";

const ZOOMS: { value: Zoom; label: string }[] = [
  { value: "page", label: "Fit page" },
  { value: "fit", label: "Fit width" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
];

interface Problem {
  severity: "error" | "warning" | "info";
  message: string;
  src?: SourceRef;
  page?: string;
}

const SEVERITY_WORD = { error: "Error", warning: "Warning", info: "Note" } as const;

/** The free edition has no Pro to point to, so its messages say what it includes. */
function editionMessage(message: string): string {
  if (!FREE_EDITION) return message;
  return message.replace(/ (is|are) part of Book Studio Pro\./, " $1n’t included in this edition.").replace(/ Free (includes|prints)/, " This edition $1");
}

export class Studio {
  readonly root: HTMLElement;
  private books: BookChoice[] = [];
  private current: string | null = null;
  private built: Built | null = null;
  private fonts: Promise<FontSet> | null = null;
  private painter: PagePainter | null = null;
  private building: Promise<void> | null = null;
  private queued = false;
  private timer = 0;
  private relistPending = false;
  private gen = 0;
  private observer: IntersectionObserver | null = null;
  private resize: ResizeObserver | null = null;
  private unsubscribe: () => void;
  private disposed = false;
  private kdp: KdpPanel;

  private bookSelect = h("select", { cls: "bs-book", attr: { "aria-label": "Book" } });
  private planBox = h("div", { cls: "bs-plan" });
  private settingsBar = h("div", { cls: "bs-bar bs-settings" });
  private status = h("p", { cls: "bs-status", attr: { role: "status", "aria-live": "polite" } });
  private tabs: Record<Tab, HTMLButtonElement>;
  private panels: Record<Tab, HTMLElement>;
  private pagesEl = h("div", { cls: "bs-pages", attr: { tabindex: 0, "aria-label": "Page preview" } });
  private previewTools = h("div", { cls: "bs-bar bs-preview-tools" });
  private pdfButton = h("button", { cls: "mod-cta bs-primary", text: "Export print PDF" });
  private epubButton = h("button", { text: "Export EPUB" });
  private reportButton = h("button", { text: "Accessibility report" });

  constructor(
    private host: StudioHost,
    container: HTMLElement,
    private license: LicenseManager,
  ) {
    const tabIds: Tab[] = ["preview", "problems", "kdp", "accessibility"];
    const uid = Math.random().toString(36).slice(2, 8);
    this.tabs = {} as Record<Tab, HTMLButtonElement>;
    this.panels = {} as Record<Tab, HTMLElement>;
    for (const t of tabIds) {
      this.tabs[t] = h("button", { cls: "bs-tab", attr: { role: "tab", id: `bs-tab-${t}-${uid}`, "aria-controls": `bs-panel-${t}-${uid}` }, on: { click: () => this.showTab(t), keydown: (e) => this.tabKey(e, t) } });
      this.panels[t] = h("div", { cls: `bs-panel bs-panel-${t}`, attr: { role: "tabpanel", id: `bs-panel-${t}-${uid}`, "aria-labelledby": `bs-tab-${t}-${uid}` } });
    }
    this.panels.preview.append(this.previewTools, this.pagesEl);

    this.bookSelect.addEventListener("change", () => this.chooseBook(this.bookSelect.value));
    this.pdfButton.addEventListener("click", () => void this.exportPdf());
    this.epubButton.addEventListener("click", () => void this.exportEpub());
    this.reportButton.addEventListener("click", () => void this.exportReport());
    this.reportButton.hidden = FREE_EDITION;

    this.root = h(
      "div",
      { cls: "bs-studio" },
      h(
        "div",
        { cls: "bs-bar bs-top" },
        h("label", { cls: "bs-field" }, h("span", { text: "Book" }), this.bookSelect),
        h("button", { text: "Rebuild", attr: { title: "Read the notes again and rebuild the book" }, on: { click: () => void this.refresh() } }),
        h("span", { cls: "bs-spacer" }),
        this.planBox,
      ),
      this.settingsBar,
      h("div", { cls: "bs-bar bs-actions" }, this.pdfButton, this.epubButton, this.reportButton),
      this.status,
      h("div", { cls: "bs-tabs", attr: { role: "tablist", "aria-label": "Book Studio views" } }, ...tabIds.map((t) => this.tabs[t])),
      ...tabIds.map((t) => this.panels[t]),
    );
    this.kdp = new KdpPanel(this.panels.kdp, {
      host: this.host,
      plan: () => this.plan(),
      built: () => this.built,
      fonts: () => this.loadFonts(),
      painter: () => this.painter,
      gate: async (b) => (await this.gate(b)) === true,
      write: (m, make) => this.write(m, make),
      showPage: (folio) => {
        const index = this.built?.layout.pages.findIndex((p) => p.folio === folio) ?? -1;
        if (index >= 0) this.scrollToPage(index);
      },
      openLicense: () => this.host.openLicense(),
    });
    container.appendChild(this.root);
    this.unsubscribe = this.license.onChange(() => this.planChanged());
    this.showTab("preview");
    this.renderPlan();
    this.renderTabs();
  }

  // ── Books ──

  /** Re-list the books and rebuild the current one. */
  async refresh(): Promise<void> {
    this.books = this.host.source() ? await this.host.listBooks() : [];
    const last = this.host.store.get<string>("lastBook");
    const keep = [this.current, last].find((p) => p && this.books.some((b) => b.path === p));
    this.current = keep ?? this.books[0]?.path ?? null;
    clear(this.bookSelect);
    const shared = (t: string) => this.books.filter((o) => o.title === t).length > 1;
    for (const b of this.books) {
      const text = b.title === b.path || !shared(b.title) ? b.title : `${b.title} (${b.path})`;
      append(this.bookSelect, h("option", { attr: { value: b.path, title: b.path } }, text));
    }
    if (this.current) this.bookSelect.value = this.current;
    this.bookSelect.disabled = this.books.length === 0;
    if (!this.current) {
      this.built = null;
      this.renderEmpty();
      return;
    }
    await this.build();
  }

  private chooseBook(path: string): void {
    this.current = path;
    this.host.store.set("lastBook", path);
    void this.build();
  }

  /** True if `path` is part of the book on show, so editing it should rebuild. */
  usesFile(path: string): boolean {
    const b = this.built?.book;
    if (!b) return false;
    return path === b.manifestPath || b.chapters.some((c) => c.file === path) || b.embeds.has(path) || b.images.has(path) || b.meta.cover?.path === path;
  }

  get bookPath(): string | null {
    return this.current;
  }

  /** True if `path` is one of the books in the picker. */
  listsBook(path: string): boolean {
    return this.books.some((b) => b.path === path);
  }

  /** Rebuild after `delay` ms; `relist` also looks for new or renamed books first. */
  scheduleBuild(delay = 800, relist = false): void {
    window.clearTimeout(this.timer);
    this.relistPending ||= relist;
    this.timer = window.setTimeout(() => void this.runScheduled(), delay);
  }

  private runScheduled(): Promise<void> {
    window.clearTimeout(this.timer);
    this.timer = 0;
    const again = this.relistPending;
    this.relistPending = false;
    return again ? this.refresh() : this.build();
  }

  // ── Building ──

  private key(path: string): string {
    return this.host.bookKey?.(path) ?? path;
  }

  private overrides(): Partial<BookSettings> {
    return (this.current && this.host.store.get<Partial<BookSettings>>(`settings:${this.key(this.current)}`)) || {};
  }

  private setOverride(patch: Partial<BookSettings>): void {
    if (!this.current) return;
    this.host.store.set(`settings:${this.key(this.current)}`, { ...this.overrides(), ...patch });
    void this.build();
  }

  private loadFonts(): Promise<FontSet> {
    this.fonts ??= FontSet.load(this.host.loadFont);
    return this.fonts;
  }

  async build(): Promise<void> {
    if (this.building) {
      this.queued = true;
      return this.building;
    }
    this.building = this.runBuild();
    try {
      await this.building;
    } finally {
      this.building = null;
    }
    if (this.queued && !this.disposed) {
      this.queued = false;
      await this.build();
    }
  }

  private async runBuild(): Promise<void> {
    const source = this.host.source();
    const path = this.current;
    if (!source || !path) return this.renderEmpty();
    this.setStatus("Building…", true);
    await nextFrame();
    try {
      const fonts = await this.loadFonts();
      const built = await buildBook(source, path, fonts, this.overrides());
      if (this.disposed || path !== this.current) return;
      this.painter?.dispose();
      this.painter = new PagePainter(fonts, built.book.images);
      this.kdp.fontsNow = fonts;
      this.built = built;
      this.renderAll();
    } catch (e) {
      console.error("Book Studio:", e);
      this.setStatus(`Couldn't build the book: ${e instanceof Error ? e.message : String(e)}`, false, true);
    }
  }

  private async ensureBuilt(): Promise<Built | null> {
    // An edit made just before exporting is still waiting for its rebuild: run it now.
    if (this.timer) await this.runScheduled();
    // A build asked for mid-build runs right after it, so wait for the last one.
    while (this.building) await this.building;
    if (!this.built && this.current) await this.build();
    return this.built;
  }

  // ── Plan ──

  private plan(): Plan {
    return this.license.plan();
  }

  private planChanged(): void {
    this.renderPlan();
    if (this.built) this.renderAll();
  }

  private renderPlan(): void {
    clear(this.planBox);
    if (FREE_EDITION) return;
    const plan = this.plan();
    const label = this.license.previewPro ? "Pro preview" : plan === "pro" ? "Pro" : "Free plan";
    append(this.planBox, h("span", { cls: ["bs-badge", plan === "pro" && "is-pro"], text: label }));
    if (PRO_PREVIEW) {
      const box = h("input", { attr: { type: "checkbox", checked: this.license.previewPro } });
      box.addEventListener("change", () => (this.license.previewPro = box.checked));
      append(this.planBox, h("label", { cls: "bs-check", attr: { title: "This prototype build lets you try Pro without a key" } }, box, "Try Pro"));
    }
    append(this.planBox, h("button", { text: plan === "pro" && !this.license.previewPro ? "License" : "Get Pro", on: { click: () => this.host.openLicense() } }));
  }

  /**
   * Ask before an export the plan doesn't include. Resolves true to go ahead, or
   * "sample" when the person picks the watermarked sample (print PDFs only).
   */
  private async gate(blockers: ExportBlocker[], offerSample = false): Promise<boolean | "sample"> {
    if (!blockers.length) return true;
    if (FREE_EDITION) {
      await this.host.ask({ title: "Not available in this edition", message: `${blockers.map((b) => editionMessage(b.message)).join("\n")}\n\nChoose an included option in the toolbar to export.`, ok: "OK" });
      return false;
    }
    const answer = await this.host.ask({
      title: "This export needs Book Studio Pro",
      message: `${blockers.map((b) => b.message).join("\n")}\n\nYou can keep previewing everything; switch to an included option to export on the free plan.${offerSample ? " Or export a sample: the same PDF with a SAMPLE watermark on every page, to try in KDP's previewer." : ""}`,
      ok: "Get Pro",
      cancel: "Not now",
      extra: offerSample ? "Export a sample" : PRO_PREVIEW ? "Try Pro preview" : undefined,
    });
    if (answer === "ok") this.host.openLicense();
    if (answer === "extra") {
      if (offerSample) return "sample";
      this.license.previewPro = true;
      return true;
    }
    return false;
  }

  private choices(): EpubChoices {
    return { claim: this.host.store.get<boolean>("claim") ?? true, certifiedBy: this.host.store.get<string>("certifiedBy") };
  }

  // ── Exports ──

  async exportPdf(): Promise<void> {
    const built = await this.ensureBuilt();
    if (!built) return this.host.notify("Open a book first.");
    const go = await this.gate(pdfBlockers(this.plan(), built), true);
    if (!go) return;
    const sample = go === "sample";
    await this.write(sample ? "Writing the sample PDF…" : "Writing the print PDF…", async () => {
      const out = await exportPdf(built, await this.loadFonts(), { sample });
      return { ...out, mime: "application/pdf" };
    });
  }

  async exportEpub(): Promise<void> {
    const built = await this.ensureBuilt();
    if (!built) return this.host.notify("Open a book first.");
    if ((await this.gate(ebookBlockers(this.plan(), built))) !== true) return;
    const plan = this.plan();
    await this.write("Writing the EPUB…", async () => {
      const out = await exportEpub(built, await this.loadFonts(), plan, this.choices());
      return { ...out, mime: "application/epub+zip" };
    });
  }

  async exportReport(): Promise<void> {
    const built = await this.ensureBuilt();
    if (!built) return this.host.notify("Open a book first.");
    if (FREE_EDITION) return this.host.notify("The accessibility report isn't part of this edition.");
    if (!hasFeature(this.plan(), "accessiblePack")) {
      await this.gate([{ feature: "accessiblePack", message: "The accessibility report is part of the accessible EPUB pack in Book Studio Pro." }]);
      if (!hasFeature(this.plan(), "accessiblePack")) return;
    }
    await this.write("Writing the report…", async () => ({ ...exportReport(built, this.plan(), this.choices()), mime: "text/html" }));
  }

  private async write(message: string, make: () => Promise<{ name: string; mime: string; data: Uint8Array | string }>): Promise<void> {
    const before = this.status.textContent ?? "";
    this.setStatus(message, true);
    await nextFrame();
    try {
      const out = await make();
      const where = await this.host.save(out);
      if (where) this.host.notify(where);
      this.setStatus(before);
    } catch (e) {
      console.error("Book Studio:", e);
      this.setStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`, false, true);
    }
  }

  // ── Rendering ──

  private setStatus(text: string, busy = false, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle("is-busy", busy);
    this.status.classList.toggle("is-error", error);
    this.root.classList.toggle("is-building", busy);
  }

  private renderEmpty(): void {
    this.setStatus(this.host.source() ? "No book found in this folder." : "");
    clear(this.settingsBar);
    clear(this.previewTools);
    clear(this.pagesEl);
    this.observer?.disconnect();
    const box = h("div", { cls: "bs-empty" });
    if (this.host.renderEmpty) this.host.renderEmpty(box);
    append(
      box,
      h("p", { text: "A book is a note with book: true in its frontmatter that lists the chapters in order:" }),
      h("pre", { text: "---\nbook: true\ntitle: The Lighthouse Keeper\nauthor: Jane Doe\n---\n## Chapters\n1. [[The Storm]]\n2. [[Landfall]]" }),
    );
    this.pagesEl.appendChild(box);
    for (const b of [this.pdfButton, this.epubButton, this.reportButton]) b.disabled = true;
    this.renderTabs();
  }

  private renderAll(): void {
    const built = this.built;
    if (!built) return;
    for (const b of [this.pdfButton, this.epubButton, this.reportButton]) b.disabled = false;
    this.renderSettings();
    this.renderStatus();
    this.renderPreview();
    this.renderProblems();
    this.kdp.render();
    this.renderAccessibility();
    this.renderTabs();
  }

  private renderStatus(): void {
    const { book, layout, ms } = this.built!;
    const pages = layout.pages.length;
    const gutter = (layout.margins.inside / 72).toFixed(3).replace(/0+$/, "");
    this.setStatus(`${book.meta.title}: ${pages} pages at ${layout.trim.label}, inside margin ${gutter} in, spine ${spineWidth(pages, book.settings.paper).toFixed(3)} in on ${book.settings.paper === "white" ? "white" : book.settings.paper === "cream" ? "cream" : "premium color"} paper. Built in ${ms} ms.`);
  }

  private renderSettings(): void {
    const { book } = this.built!;
    const s = book.settings;
    const plan = this.plan();
    clear(this.settingsBar);
    const theme = select(
      THEMES.filter((t) => !FREE_EDITION || themeAllowed(plan, t.id) || t.id === s.theme).map((t) => ({ value: t.id, label: t.name, badge: themeAllowed(plan, t.id) ? undefined : FREE_EDITION ? "Not included" : "Pro" })),
      s.theme,
      { attr: { "aria-label": "Theme" }, on: { change: () => this.setOverride({ theme: theme.value }) } },
    );
    const trim = select(
      TRIMS.filter((t) => !FREE_EDITION || trimAllowed(plan, t.id) || t.id === s.trim).map((t) => ({ value: t.id, label: t.label, badge: trimAllowed(plan, t.id) ? undefined : FREE_EDITION ? "Not included" : "Pro" })),
      s.trim,
      { attr: { "aria-label": "Trim size" }, on: { change: () => this.setOverride({ trim: trim.value }) } },
    );
    const paper = select(
      (["white", "cream", "color"] as const).map((p) => ({ value: p, label: { white: "White paper", cream: "Cream paper", color: "Premium color" }[p] })),
      s.paper,
      { attr: { "aria-label": "Interior paper" }, on: { change: () => this.setOverride({ paper: paper.value as BookSettings["paper"] }) } },
    );
    const start = select(
      [
        { value: "recto", label: "Right-hand page" },
        { value: "any", label: "Next page" },
      ],
      s.chapterStart,
      { attr: { "aria-label": "Chapters start on" }, on: { change: () => this.setOverride({ chapterStart: start.value as BookSettings["chapterStart"] }) } },
    );
    const bleed = h("input", { attr: { type: "checkbox", checked: s.bleed }, on: { change: () => this.setOverride({ bleed: bleed.checked }) } });
    append(
      this.settingsBar,
      h("label", { cls: "bs-field" }, h("span", { text: "Theme" }), theme),
      h("label", { cls: "bs-field" }, h("span", { text: "Trim" }), trim),
      h("label", { cls: "bs-field" }, h("span", { text: "Paper" }), paper),
      h("label", { cls: "bs-field" }, h("span", { text: "Chapters start on" }), start),
      h("label", { cls: "bs-check" }, bleed, "Bleed"),
    );
    if (Object.keys(this.overrides()).length) {
      append(
        this.settingsBar,
        h("button", {
          cls: "bs-link",
          text: "Use the manifest’s settings",
          attr: { title: "Forget the choices made here and use the book note’s frontmatter" },
          on: {
            click: () => {
              if (this.current) this.host.store.set(`settings:${this.key(this.current)}`, undefined);
              void this.build();
            },
          },
        }),
      );
    }
    const blockers = [...new Set([...pdfBlockers(plan, this.built!), ...ebookBlockers(plan, this.built!)].map((b) => editionMessage(b.message)))];
    if (blockers.length) append(this.settingsBar, h("p", { cls: "bs-pro-note", text: FREE_EDITION ? `${blockers.join(" ")} Choose an included option to export.` : `Previewing Pro options. ${blockers.join(" ")}` }));
  }

  // ── Preview ──

  private zoom(): Zoom {
    return this.host.store.get<Zoom>("zoom") ?? "page";
  }

  private renderPreview(): void {
    const { layout } = this.built!;
    // Keep the reader's place across rebuilds.
    const keep = this.firstVisiblePage();
    clear(this.previewTools);
    const zoom = select(ZOOMS, this.zoom(), {
      attr: { "aria-label": "Zoom" },
      on: {
        change: () => {
          this.host.store.set("zoom", zoom.value);
          this.renderPreview();
        },
      },
    });
    const spreads = h("input", { attr: { type: "checkbox", checked: this.host.store.get<boolean>("spreads") ?? true } });
    spreads.addEventListener("change", () => {
      this.host.store.set("spreads", spreads.checked);
      this.renderPreview();
    });
    const guides = h("input", { attr: { type: "checkbox", checked: this.host.store.get<boolean>("guides") ?? false } });
    guides.addEventListener("change", () => {
      this.host.store.set("guides", guides.checked);
      this.renderPreview();
    });
    const jumpOptions = [{ value: "", label: "Go to…" }, ...layout.toc.map((t) => ({ value: t.chapterId, label: `${t.title} · ${t.folio}` }))];
    const jump = select(jumpOptions, "", {
      attr: { "aria-label": "Go to a chapter" },
      on: {
        change: () => {
          const index = layout.pages.findIndex((p) => p.chapterId === jump.value);
          if (index >= 0) this.scrollToPage(index);
          jump.value = "";
        },
      },
    });
    append(
      this.previewTools,
      h("label", { cls: "bs-field" }, h("span", { text: "Zoom" }), zoom),
      h("label", { cls: "bs-check" }, spreads, "Facing pages"),
      h("label", { cls: "bs-check" }, guides, "Margins"),
      jump,
    );

    this.gen++;
    this.observer?.disconnect();
    this.resize?.disconnect();
    clear(this.pagesEl);
    const showGuides = guides.checked;
    const facing = spreads.checked;
    const bleed = showGuides ? layout.bleedPt : 0;
    const pageW = layout.widthPt + bleed;
    const pageH = layout.heightPt + 2 * bleed;
    const scale = this.scaleFor(facing ? 2 * pageW + 12 : pageW, pageH);
    this.pagesEl.style.setProperty("--bs-page-w", `${Math.round(pageW * scale)}px`);
    this.pagesEl.style.setProperty("--bs-page-h", `${Math.round(pageH * scale)}px`);
    this.pagesEl.classList.toggle("is-facing", facing);

    const total = layout.pages.length;
    const rows: number[][] = [];
    if (facing) {
      // The first page is a recto on its own; then versos face rectos.
      rows.push([0]);
      for (let i = 1; i < total; i += 2) rows.push(i + 1 < total ? [i, i + 1] : [i]);
    } else for (let i = 0; i < total; i++) rows.push([i]);

    const gen = this.gen;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const fig = e.target as HTMLElement;
          const canvas = fig.querySelector("canvas");
          if (!canvas) continue;
          const page = layout.pages[Number(fig.dataset.index)];
          if (e.isIntersecting) {
            if (fig.dataset.painted) continue;
            fig.dataset.painted = "1";
            void this.painter?.paint(canvas, layout, page, { scale, dpr, guides: showGuides }).then(() => {
              if (gen !== this.gen) return;
              fig.classList.add("is-painted");
            });
          } else if (fig.dataset.painted) {
            // Free the pixels of pages far off screen.
            delete fig.dataset.painted;
            fig.classList.remove("is-painted");
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      },
      { root: this.pagesEl, rootMargin: "1200px 0px" },
    );

    for (const row of rows) {
      const spread = h("div", { cls: ["bs-spread", row.length === 1 && facing && layout.pages[row[0]].recto && "is-recto-only"] });
      for (const i of row) {
        const p = layout.pages[i];
        const label = p.role === "blank" ? `Blank page ${i + 1} of ${total}` : `Page ${p.folio}, ${i + 1} of ${total}`;
        const fig = h("figure", { cls: ["bs-page", p.recto ? "is-recto" : "is-verso"], attr: { "data-index": i, "aria-label": label } }, h("canvas", { attr: { role: "img", "aria-label": label } }), h("figcaption", { text: p.showFolio ? p.folio : p.role === "blank" ? "blank" : `(${p.folio})` }));
        spread.appendChild(fig);
        this.observer.observe(fig);
      }
      this.pagesEl.appendChild(spread);
    }
    if (keep !== null) this.scrollToPage(Math.min(keep, total - 1), false);

    if (this.zoom() === "fit" || this.zoom() === "page") {
      let width = this.pagesEl.clientWidth;
      let height = this.pagesEl.clientHeight;
      const byHeight = this.zoom() === "page";
      this.resize = new ResizeObserver(() => {
        const w = this.pagesEl.clientWidth;
        const ht = this.pagesEl.clientHeight;
        if (!w || (Math.abs(w - width) < 24 && (!byHeight || Math.abs(ht - height) < 24))) return;
        width = w;
        height = ht;
        window.clearTimeout(this.timerResize);
        // The book can be gone by then (its note deleted or renamed away).
        this.timerResize = window.setTimeout(() => this.built && this.renderPreview(), 150);
      });
      this.resize.observe(this.pagesEl);
    }
  }

  private timerResize = 0;

  private scaleFor(widthPt: number, heightPt: number): number {
    const z = this.zoom();
    if (z !== "fit" && z !== "page") return Number(z);
    const byWidth = Math.max(this.pagesEl.clientWidth - 48, 240) / widthPt;
    // Leave room for the caption under each page.
    const byHeight = Math.max(this.pagesEl.clientHeight - 64, 240) / heightPt;
    return Math.max(0.3, Math.min(z === "page" ? Math.min(byWidth, byHeight) : byWidth, 2));
  }

  private firstVisiblePage(): number | null {
    const top = this.pagesEl.scrollTop;
    if (!top) return null;
    for (const fig of Array.from(this.pagesEl.querySelectorAll<HTMLElement>(".bs-page"))) {
      // .bs-pages is positioned, so offsets are measured from it.
      if (fig.offsetTop + fig.offsetHeight > top) return Number(fig.dataset.index);
    }
    return null;
  }

  private scrollToPage(index: number, show = true): void {
    if (show) this.showTab("preview");
    const fig = this.pagesEl.querySelector<HTMLElement>(`.bs-page[data-index="${index}"]`);
    if (fig) this.pagesEl.scrollTop = fig.offsetTop - 12;
  }

  // ── Problems ──

  private problems(): Problem[] {
    const { book, layout } = this.built!;
    const out: Problem[] = [];
    for (const w of book.warnings) out.push({ severity: "warning", message: w.message, src: w.src });
    for (const w of layout.warnings) out.push({ severity: w.severity, message: w.message, src: w.src, page: w.page });
    const order = { error: 0, warning: 1, info: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  private renderProblems(): void {
    const panel = this.panels.problems;
    clear(panel);
    const list = this.problems();
    if (!list.some((p) => p.severity !== "info")) append(panel, h("p", { cls: "bs-good", text: "No problems found." }));
    const ul = h("ul", { cls: "bs-problems" });
    for (const p of list) {
      const li = h("li", { cls: `is-${p.severity}` }, h("strong", { text: `${SEVERITY_WORD[p.severity]}: ` }), p.message);
      if (p.src) {
        const where = `${p.src.file}, line ${p.src.line}`;
        if (this.host.openSource) {
          const src = p.src;
          append(li, " ", h("button", { cls: "bs-link", text: where, on: { click: () => this.host.openSource?.(src) } }));
        } else append(li, h("span", { cls: "bs-where", text: ` (${where})` }));
      }
      if (p.page) {
        const index = this.built!.layout.pages.findIndex((pg) => pg.folio === p.page);
        if (index >= 0) append(li, " ", h("button", { cls: "bs-link", text: `Show page ${p.page}`, on: { click: () => this.scrollToPage(index) } }));
      }
      ul.appendChild(li);
    }
    panel.appendChild(ul);
  }

  // ── Accessibility ──

  private renderAccessibility(): void {
    const panel = this.panels.accessibility;
    clear(panel);
    const { audit } = this.built!;
    const errors = audit.issues.filter((i) => i.severity === "error").length;
    const warnings = audit.issues.filter((i) => i.severity === "warning").length;
    const missingAlt = audit.images.filter((i) => !i.ok).length;

    if (!hasFeature(this.plan(), "accessiblePack")) {
      append(
        panel,
        h("p", { text: "Every EPUB Book Studio makes has semantic structure, a navigable table of contents and landmarks, and the book’s language on every page." }),
      );
      if (FREE_EDITION) return;
      append(
        panel,
        h(
          "p",
          { cls: "bs-pro-note" },
          `The accessible EPUB pack in Book Studio Pro checks the book against EPUB Accessibility 1.1 and WCAG 2.1 AA, lists every image with its description, adds the accessibility metadata stores and libraries look for, includes the print page list, and writes a report. For this book it found ${errors} problem${errors === 1 ? "" : "s"} to fix, ${warnings} to review, and ${missingAlt} image${missingAlt === 1 ? "" : "s"} without a description.`,
        ),
        h("button", { cls: "mod-cta", text: "Get Pro", on: { click: () => this.host.openLicense() } }),
      );
      return;
    }

    const verdict = audit.passed
      ? "The book passes every automated check. Its EPUB can declare conformance to EPUB Accessibility 1.1, WCAG 2.1 Level AA."
      : `Fix ${errors} problem${errors === 1 ? "" : "s"} before the EPUB can declare conformance.`;
    append(panel, h("p", { cls: ["bs-verdict", audit.passed ? "is-pass" : "is-fail"], text: verdict }));

    const choices = this.choices();
    const claim = h("input", { attr: { type: "checkbox", checked: choices.claim } });
    claim.addEventListener("change", () => this.host.store.set("claim", claim.checked));
    const cert = h("input", { attr: { type: "text", value: choices.certifiedBy ?? "", placeholder: this.built!.book.meta.publisher ?? this.built!.book.meta.authors.join(", ") } });
    cert.addEventListener("change", () => this.host.store.set("certifiedBy", cert.value.trim() || undefined));
    append(
      panel,
      h("label", { cls: "bs-check" }, claim, "Declare conformance in the EPUB when every check passes"),
      h("label", { cls: "bs-field bs-wide" }, h("span", { text: "Certified by" }), cert),
    );

    if (audit.issues.length) {
      const ul = h("ul", { cls: "bs-problems" });
      for (const i of audit.issues) {
        const li = h("li", { cls: `is-${i.severity}` }, h("strong", { text: `${SEVERITY_WORD[i.severity]}: ` }), i.message);
        if (i.fix) append(li, h("span", { cls: "bs-fix", text: ` ${i.fix}` }));
        if (i.src && this.host.openSource) {
          const src = i.src;
          append(li, " ", h("button", { cls: "bs-link", text: `${src.file}, line ${src.line}`, on: { click: () => this.host.openSource?.(src) } }));
        }
        ul.appendChild(li);
      }
      append(panel, h("h3", { text: "Findings" }), ul);
    }

    if (audit.images.length) {
      const rows = audit.images.map((img) =>
        h(
          "tr",
          null,
          h("th", { attr: { scope: "row" }, text: img.target }),
          h("td", { text: img.decorative ? "Decorative" : img.alt || "Missing" }),
          h("td", { cls: img.ok ? "bs-good" : "bs-bad", text: img.ok ? "OK" : "Needs a description" }),
        ),
      );
      append(
        panel,
        h("h3", { text: "Image descriptions" }),
        h("p", { text: "Check that each description tells someone who can’t see the image what it shows and why it’s there." }),
        h("table", { cls: "bs-table" }, h("thead", null, h("tr", null, h("th", { attr: { scope: "col" }, text: "Image" }), h("th", { attr: { scope: "col" }, text: "Description" }), h("th", { attr: { scope: "col" }, text: "Status" }))), h("tbody", null, ...rows)),
      );
    }
  }

  // ── Tabs ──

  private renderTabs(): void {
    const problems = this.built ? this.problems().filter((p) => p.severity !== "info").length : 0;
    const audit = this.built?.audit;
    const pro = hasFeature(this.plan(), "accessiblePack");
    this.tabs.preview.textContent = "Preview";
    this.tabs.problems.textContent = problems ? `Problems (${problems})` : "Problems";
    // The free edition's EPUB has no accessibility pack, so there is nothing to show.
    this.tabs.kdp.hidden = FREE_EDITION;
    this.tabs.kdp.textContent = "KDP";
    this.tabs.accessibility.hidden = FREE_EDITION;
    this.tabs.accessibility.textContent = audit && pro && !audit.passed ? "Accessibility (!)" : pro || FREE_EDITION ? "Accessibility" : "Accessibility (Pro)";
  }

  private showTab(tab: Tab): void {
    for (const t of Object.keys(this.tabs) as Tab[]) {
      const on = t === tab;
      this.tabs[t].setAttribute("aria-selected", String(on));
      this.tabs[t].tabIndex = on ? 0 : -1;
      this.panels[t].hidden = !on;
    }
  }

  private tabKey(e: KeyboardEvent, tab: Tab): void {
    const order: Tab[] = FREE_EDITION ? ["preview", "problems"] : ["preview", "problems", "kdp", "accessibility"];
    const i = order.indexOf(tab);
    let next: Tab | null = null;
    if (e.key === "ArrowRight") next = order[(i + 1) % order.length];
    else if (e.key === "ArrowLeft") next = order[(i + order.length - 1) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    this.showTab(next);
    this.tabs[next].focus();
  }

  /** Everything Pro adds, for license screens. */
  static proFeatures(): string[] {
    return Object.values(PRO_FEATURES);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.timerResize);
    this.observer?.disconnect();
    this.resize?.disconnect();
    this.painter?.dispose();
    this.unsubscribe();
    this.root.remove();
  }
}
