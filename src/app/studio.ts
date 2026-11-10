// The studio panel: pick a book, choose theme and trim, see every page as it
// will print, review problems and accessibility, and export. The Obsidian view
// and the web app both mount it; everything host-specific goes through StudioHost.

import { FREE_EDITION, PRO_PREVIEW } from "../config";
import { hasFeature, PRO_FEATURES, themeAllowed, type ExportBlocker, type Plan } from "../engine/entitlements";
import { FontSet } from "../engine/fonts";
import { LayoutCache } from "../engine/layout/index";
import type { BookSettings, SourceRef } from "../engine/model";
import { THEMES } from "../engine/themes";
import { TRIMS } from "../engine/trims";
import { PagePainter } from "../preview/canvas";
import { append, clear, h, nextFrame, select } from "./dom";
import type { BookChoice, StudioHost } from "./host";
import type { LicenseManager } from "./license-manager";
import { KdpPanel } from "./kdp-panel";
import { t, tn } from "./ui-i18n";
import { buildBook, ebookBlockers, exportCover, exportEdition, exportEpub, exportPdf, exportReport, pdfBlockers, planEditions, spineWidth, type Built, type EpubChoices } from "./pipeline";

type Tab = "preview" | "problems" | "kdp" | "accessibility";
type Zoom = "page" | "fit" | "0.5" | "0.75" | "1" | "1.5" | "2";

const zooms = (): { value: Zoom; label: string }[] => [
  { value: "page", label: t("zoom.page") },
  { value: "fit", label: t("zoom.fit") },
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

const severityWord = (s: Problem["severity"]): string => t(`sev.${s}`);

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
  /** Words and chapters already set, kept between rebuilds so an edit only sets what changed. */
  private layoutCache = new LayoutCache();
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

  private bookSelect = h("select", { cls: "bs-book", attr: { "aria-label": t("studio.book") } });
  private planBox = h("div", { cls: "bs-plan" });
  private settingsBar = h("div", { cls: "bs-bar bs-settings" });
  private status = h("p", { cls: "bs-status", attr: { role: "status", "aria-live": "polite" } });
  private tabs: Record<Tab, HTMLButtonElement>;
  private panels: Record<Tab, HTMLElement>;
  private pagesEl = h("div", { cls: "bs-pages", attr: { tabindex: 0, "aria-label": t("studio.pagePreview") } });
  private previewTools = h("div", { cls: "bs-bar bs-preview-tools" });
  private pdfButton = h("button", { cls: "mod-cta bs-primary", text: t("btn.pdf") });
  private epubButton = h("button", { text: t("btn.epub") });
  private reportButton = h("button", { text: t("btn.report") });
  private editionsButton = h("button", { text: t("btn.editions") });

  constructor(
    private host: StudioHost,
    container: HTMLElement,
    private license: LicenseManager,
  ) {
    const tabIds: Tab[] = ["preview", "problems", "kdp", "accessibility"];
    const uid = Math.random().toString(36).slice(2, 8);
    this.tabs = {} as Record<Tab, HTMLButtonElement>;
    this.panels = {} as Record<Tab, HTMLElement>;
    for (const id of tabIds) {
      this.tabs[id] = h("button", { cls: "bs-tab", attr: { role: "tab", id: `bs-tab-${id}-${uid}`, "aria-controls": `bs-panel-${id}-${uid}` }, on: { click: () => this.showTab(id), keydown: (e) => this.tabKey(e, id) } });
      this.panels[id] = h("div", { cls: `bs-panel bs-panel-${id}`, attr: { role: "tabpanel", id: `bs-panel-${id}-${uid}`, "aria-labelledby": `bs-tab-${id}-${uid}` } });
    }
    this.panels.preview.append(this.previewTools, this.pagesEl);

    this.bookSelect.addEventListener("change", () => this.chooseBook(this.bookSelect.value));
    this.pdfButton.addEventListener("click", () => void this.exportPdf());
    this.epubButton.addEventListener("click", () => void this.exportEpub());
    this.reportButton.addEventListener("click", () => void this.exportReport());
    this.reportButton.hidden = FREE_EDITION;
    this.editionsButton.hidden = true;
    this.editionsButton.addEventListener("click", () => void this.exportEditions());

    this.root = h(
      "div",
      { cls: "bs-studio" },
      h(
        "div",
        { cls: "bs-bar bs-top" },
        h("label", { cls: "bs-field" }, h("span", { text: t("studio.book") }), this.bookSelect),
        h("button", { text: t("studio.rebuild"), attr: { title: t("studio.rebuildTitle") }, on: { click: () => void this.refresh() } }),
        h("span", { cls: "bs-spacer" }),
        this.planBox,
      ),
      this.settingsBar,
      h("div", { cls: "bs-bar bs-actions" }, this.pdfButton, this.epubButton, this.reportButton, this.editionsButton),
      this.status,
      h("div", { cls: "bs-tabs", attr: { role: "tablist", "aria-label": t("studio.views") } }, ...tabIds.map((id) => this.tabs[id])),
      ...tabIds.map((id) => this.panels[id]),
    );
    this.kdp = new KdpPanel(this.panels.kdp, {
      host: this.host,
      built: () => this.built,
      fonts: () => this.loadFonts(),
      painter: () => this.painter,
      write: (m, make) => this.write(m, make),
      showPage: (folio) => {
        const index = this.built?.layout.pages.findIndex((p) => p.folio === folio) ?? -1;
        if (index >= 0) this.scrollToPage(index);
      },
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
    const shared = (title: string) => this.books.filter((o) => o.title === title).length > 1;
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

  /** The book's fonts, loaded once (for the first-book guide's style thumbnails). */
  fontSet(): Promise<FontSet> {
    return this.loadFonts();
  }

  /** Called after each build of the book finishes and its screens are drawn. */
  onBuilt: (() => void) | null = null;

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
    this.setStatus(t("build.building"), true);
    await nextFrame();
    try {
      const fonts = await this.loadFonts();
      const built = await buildBook(source, path, fonts, this.overrides(), { cache: this.layoutCache, layout: this.host.layout?.bind(this.host) });
      if (this.disposed || path !== this.current) return;
      this.painter?.dispose();
      this.painter = new PagePainter(fonts, built.book.images);
      this.kdp.fontsNow = fonts;
      this.built = built;
      this.renderAll();
      this.onBuilt?.();
    } catch (e) {
      console.error("Book Studio:", e);
      this.setStatus(t("build.failed", { error: e instanceof Error ? e.message : String(e) }), false, true);
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
    const label = this.license.previewPro ? t("plan.proPreview") : plan === "pro" ? t("plan.pro") : t("plan.free");
    append(this.planBox, h("span", { cls: ["bs-badge", plan === "pro" && "is-pro"], text: label }));
    if (PRO_PREVIEW) {
      const box = h("input", { attr: { type: "checkbox", checked: this.license.previewPro } });
      box.addEventListener("change", () => (this.license.previewPro = box.checked));
      append(this.planBox, h("label", { cls: "bs-check", attr: { title: t("plan.tryProTitle") } }, box, t("plan.tryPro")));
    }
    append(this.planBox, h("button", { text: plan === "pro" && !this.license.previewPro ? t("plan.license") : t("plan.getPro"), on: { click: () => this.host.openLicense() } }));
  }

  /**
   * Ask before an export the plan doesn't include. Resolves true to go ahead, or
   * "sample" when the person picks the watermarked sample (print PDFs only).
   */
  private async gate(blockers: ExportBlocker[], offerSample = false): Promise<boolean | "sample"> {
    if (!blockers.length) return true;
    if (FREE_EDITION) {
      await this.host.ask({ title: t("gate.notInEditionTitle"), message: t("gate.notInEditionMessage", { messages: blockers.map((b) => editionMessage(b.message)).join("\n") }), ok: t("gate.ok") });
      return false;
    }
    const answer = await this.host.ask({
      title: t("gate.needsProTitle"),
      message: t("gate.needsProMessage", { messages: blockers.map((b) => b.message).join("\n") }) + (offerSample ? t("gate.sampleOffer") : ""),
      ok: t("gate.getPro"),
      cancel: t("gate.notNow"),
      extra: offerSample ? t("gate.exportSample") : PRO_PREVIEW ? t("gate.tryProPreview") : undefined,
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
    if (!built) return this.host.notify(t("export.openFirst"));
    const go = await this.gate(pdfBlockers(this.plan(), built), true);
    if (!go) return;
    const sample = go === "sample";
    await this.write(sample ? t("export.sampleWriting") : t("export.pdfWriting"), async () => {
      const out = await exportPdf(built, await this.loadFonts(), { sample });
      return { ...out, mime: "application/pdf" };
    });
  }

  /** The full wraparound cover as a PDF (what the KDP tab's button makes). */
  async exportCoverPdf(): Promise<void> {
    const built = await this.ensureBuilt();
    if (!built) return this.host.notify(t("export.openFirst"));
    await this.write(t("kdp.writingCover"), async () => {
      const out = await exportCover(built, await this.loadFonts());
      return { name: out.name, mime: "application/pdf", data: out.data };
    });
  }

  async exportEpub(): Promise<void> {
    const built = await this.ensureBuilt();
    if (!built) return this.host.notify(t("export.openFirst"));
    if ((await this.gate(ebookBlockers(this.plan(), built))) !== true) return;
    const plan = this.plan();
    await this.write(t("export.epubWriting"), async () => {
      const out = await exportEpub(built, await this.loadFonts(), plan, this.choices());
      return { ...out, mime: "application/epub+zip" };
    });
  }

  async exportReport(): Promise<void> {
    const built = await this.ensureBuilt();
    if (!built) return this.host.notify(t("export.openFirst"));
    if (FREE_EDITION) return this.host.notify(t("export.reportNotInEdition"));
    if (!hasFeature(this.plan(), "accessiblePack")) {
      await this.gate([{ feature: "accessiblePack", message: t("export.reportPro") }]);
      if (!hasFeature(this.plan(), "accessiblePack")) return;
    }
    await this.write(t("export.reportWriting"), async () => ({ ...exportReport(built, this.plan(), this.choices()), mime: "text/html" }));
  }

  async exportEditions(): Promise<void> {
    const built = await this.ensureBuilt();
    const source = this.host.source();
    const path = this.current;
    if (!built || !source || !path) return this.host.notify(t("export.openFirst"));
    const plan = planEditions(built.book);
    if (!plan.editions.length) return this.host.notify(t("export.noEditions"));
    if (!hasFeature(this.plan(), "editions")) {
      await this.gate([{ feature: "editions", message: t("export.editionsPro") }]);
      if (!hasFeature(this.plan(), "editions")) return;
    }
    if (plan.problems.length) {
      const answer = await this.host.ask({ title: t("export.checkEditionsTitle"), message: t("export.checkEditionsMessage", { problems: plan.problems.join("\n") }), ok: t("export.anyway"), cancel: t("export.cancel") });
      if (answer !== "ok") return;
    }
    const fonts = await this.loadFonts();
    const before = this.status.textContent ?? "";
    try {
      // One edition at a time: a phone shouldn't have to hold several books in memory.
      for (const [i, edition] of plan.editions.entries()) {
        this.setStatus(t("export.buildingEdition", { id: edition.id, i: i + 1, total: plan.editions.length }), true);
        await nextFrame();
        const files = await exportEdition(source, path, fonts, edition, this.plan(), this.choices());
        for (const f of files) await this.host.save(f);
      }
      this.host.notify(tn("export.editionsDone", plan.editions.length));
      this.setStatus(before);
    } catch (e) {
      console.error("Book Studio:", e);
      this.setStatus(t("export.failed", { error: e instanceof Error ? e.message : String(e) }), false, true);
    }
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
      this.setStatus(t("export.failed", { error: e instanceof Error ? e.message : String(e) }), false, true);
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
    this.setStatus(this.host.source() ? t("empty.noBook") : "");
    clear(this.settingsBar);
    clear(this.previewTools);
    clear(this.pagesEl);
    this.observer?.disconnect();
    const box = h("div", { cls: "bs-empty" });
    if (this.host.renderEmpty) this.host.renderEmpty(box);
    append(
      box,
      h("p", { text: t("empty.howTo") }),
      h("pre", { text: "---\nbook: true\ntitle: The Lighthouse Keeper\nauthor: Jane Doe\n---\n## Chapters\n1. [[The Storm]]\n2. [[Landfall]]" }),
    );
    this.pagesEl.appendChild(box);
    for (const b of [this.pdfButton, this.epubButton, this.reportButton, this.editionsButton]) b.disabled = true;
    this.renderTabs();
  }

  private renderAll(): void {
    const built = this.built;
    if (!built) return;
    for (const b of [this.pdfButton, this.epubButton, this.reportButton, this.editionsButton]) b.disabled = false;
    this.editionsButton.hidden = FREE_EDITION || Object.keys(built.book.meta.editions).length === 0;
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
    const paper = book.settings.paper === "white" ? t("paper.statusWhite") : book.settings.paper === "cream" ? t("paper.statusCream") : t("paper.statusColor");
    this.setStatus(t("status.built", { title: book.meta.title, pages, trim: layout.trim.label, gutter, spine: spineWidth(pages, book.settings.paper).toFixed(3), paper, ms }));
  }

  private renderSettings(): void {
    const { book } = this.built!;
    const s = book.settings;
    const plan = this.plan();
    clear(this.settingsBar);
    const theme = select(
      THEMES.filter((th) => !FREE_EDITION || themeAllowed(plan, th.id) || th.id === s.theme).map((th) => ({ value: th.id, label: th.name, badge: themeAllowed(plan, th.id) ? undefined : FREE_EDITION ? t("set.notIncluded") : t("set.pro") })),
      s.theme,
      { attr: { "aria-label": t("set.theme") }, on: { change: () => this.setOverride({ theme: theme.value }) } },
    );
    const trim = select(
      TRIMS.map((tr) => ({ value: tr.id, label: tr.label })),
      s.trim,
      { attr: { "aria-label": t("set.trimAria") }, on: { change: () => this.setOverride({ trim: trim.value }) } },
    );
    const paper = select(
      (["white", "cream", "color"] as const).map((p) => ({ value: p, label: t(`paper.${p}`) })),
      s.paper,
      { attr: { "aria-label": t("set.paperAria") }, on: { change: () => this.setOverride({ paper: paper.value as BookSettings["paper"] }) } },
    );
    const start = select(
      [
        { value: "recto", label: t("start.recto") },
        { value: "any", label: t("start.any") },
      ],
      s.chapterStart,
      { attr: { "aria-label": t("set.chapterStart") }, on: { change: () => this.setOverride({ chapterStart: start.value as BookSettings["chapterStart"] }) } },
    );
    const bleed = h("input", { attr: { type: "checkbox", checked: s.bleed }, on: { change: () => this.setOverride({ bleed: bleed.checked }) } });
    append(
      this.settingsBar,
      h("label", { cls: "bs-field" }, h("span", { text: t("set.theme") }), theme),
      h("label", { cls: "bs-field" }, h("span", { text: t("set.trim") }), trim),
      h("label", { cls: "bs-field" }, h("span", { text: t("set.paper") }), paper),
      h("label", { cls: "bs-field" }, h("span", { text: t("set.chapterStart") }), start),
      h("label", { cls: "bs-check" }, bleed, t("set.bleed")),
    );
    if (Object.keys(this.overrides()).length) {
      append(
        this.settingsBar,
        h("button", {
          cls: "bs-link",
          text: t("set.useManifest"),
          attr: { title: t("set.useManifestTitle") },
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
    if (blockers.length) append(this.settingsBar, h("p", { cls: "bs-pro-note", text: FREE_EDITION ? t("set.chooseIncluded", { blockers: blockers.join(" ") }) : t("set.previewingPro", { blockers: blockers.join(" ") }) }));
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
    const zoom = select(zooms(), this.zoom(), {
      attr: { "aria-label": t("pv.zoom") },
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
    const jumpOptions = [{ value: "", label: t("pv.goTo") }, ...layout.toc.map((e) => ({ value: e.chapterId, label: `${e.title} · ${e.folio}` }))];
    const jump = select(jumpOptions, "", {
      attr: { "aria-label": t("pv.goToAria") },
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
      h("label", { cls: "bs-field" }, h("span", { text: t("pv.zoom") }), zoom),
      h("label", { cls: "bs-check" }, spreads, t("pv.facing")),
      h("label", { cls: "bs-check" }, guides, t("pv.margins")),
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
        const label = p.role === "blank" ? t("pv.blankPage", { n: i + 1, total }) : t("pv.page", { folio: p.folio, n: i + 1, total });
        const fig = h("figure", { cls: ["bs-page", p.recto ? "is-recto" : "is-verso"], attr: { "data-index": i, "aria-label": label } }, h("canvas", { attr: { role: "img", "aria-label": label } }), h("figcaption", { text: p.showFolio ? p.folio : p.role === "blank" ? t("pv.blank") : `(${p.folio})` }));
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
    if (!list.some((p) => p.severity !== "info")) append(panel, h("p", { cls: "bs-good", text: t("prob.none") }));
    const ul = h("ul", { cls: "bs-problems" });
    for (const p of list) {
      const li = h("li", { cls: `is-${p.severity}` }, h("strong", { text: `${severityWord(p.severity)}: ` }), p.message);
      if (p.src) {
        const where = t("prob.where", { file: p.src.file, line: p.src.line });
        if (this.host.openSource) {
          const src = p.src;
          append(li, " ", h("button", { cls: "bs-link", text: where, on: { click: () => this.host.openSource?.(src) } }));
        } else append(li, h("span", { cls: "bs-where", text: ` (${where})` }));
      }
      if (p.page) {
        const index = this.built!.layout.pages.findIndex((pg) => pg.folio === p.page);
        if (index >= 0) append(li, " ", h("button", { cls: "bs-link", text: t("prob.showPage", { folio: p.page }), on: { click: () => this.scrollToPage(index) } }));
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
        h("p", { text: t("a11y.intro") }),
      );
      if (FREE_EDITION) return;
      append(
        panel,
        h(
          "p",
          { cls: "bs-pro-note" },
          t("a11y.proNote", { problems: tn("n.problem", errors), warnings, images: tn("n.image", missingAlt) }),
        ),
        h("button", { cls: "mod-cta", text: t("plan.getPro"), on: { click: () => this.host.openLicense() } }),
      );
      return;
    }

    const verdict = audit.passed
      ? t("a11y.pass")
      : t("a11y.fix", { problems: tn("n.problem", errors) });
    append(panel, h("p", { cls: ["bs-verdict", audit.passed ? "is-pass" : "is-fail"], text: verdict }));

    const choices = this.choices();
    const claim = h("input", { attr: { type: "checkbox", checked: choices.claim } });
    claim.addEventListener("change", () => this.host.store.set("claim", claim.checked));
    const cert = h("input", { attr: { type: "text", value: choices.certifiedBy ?? "", placeholder: this.built!.book.meta.publisher ?? this.built!.book.meta.authors.join(", ") } });
    cert.addEventListener("change", () => this.host.store.set("certifiedBy", cert.value.trim() || undefined));
    append(
      panel,
      h("label", { cls: "bs-check" }, claim, t("a11y.claim")),
      h("label", { cls: "bs-field bs-wide" }, h("span", { text: t("a11y.certifiedBy") }), cert),
    );

    if (audit.issues.length) {
      const ul = h("ul", { cls: "bs-problems" });
      for (const i of audit.issues) {
        const li = h("li", { cls: `is-${i.severity}` }, h("strong", { text: `${severityWord(i.severity)}: ` }), i.message);
        if (i.fix) append(li, h("span", { cls: "bs-fix", text: ` ${i.fix}` }));
        if (i.src && this.host.openSource) {
          const src = i.src;
          append(li, " ", h("button", { cls: "bs-link", text: `${src.file}, line ${src.line}`, on: { click: () => this.host.openSource?.(src) } }));
        }
        ul.appendChild(li);
      }
      append(panel, h("h3", { text: t("a11y.findings") }), ul);
    }

    if (audit.images.length) {
      const rows = audit.images.map((img) =>
        h(
          "tr",
          null,
          h("th", { attr: { scope: "row" }, text: img.target }),
          h("td", { text: img.decorative ? t("a11y.decorative") : img.alt || t("a11y.missing") }),
          h("td", { cls: img.ok ? "bs-good" : "bs-bad", text: img.ok ? t("a11y.ok") : t("a11y.needsDescription") }),
        ),
      );
      append(
        panel,
        h("h3", { text: t("a11y.images") }),
        h("p", { text: t("a11y.imagesHelp") }),
        h("table", { cls: "bs-table" }, h("thead", null, h("tr", null, h("th", { attr: { scope: "col" }, text: t("a11y.colImage") }), h("th", { attr: { scope: "col" }, text: t("a11y.colDescription") }), h("th", { attr: { scope: "col" }, text: t("a11y.colStatus") }))), h("tbody", null, ...rows)),
      );
    }
  }

  // ── Tabs ──

  private renderTabs(): void {
    const problems = this.built ? this.problems().filter((p) => p.severity !== "info").length : 0;
    const audit = this.built?.audit;
    const pro = hasFeature(this.plan(), "accessiblePack");
    this.tabs.preview.textContent = t("tab.preview");
    this.tabs.problems.textContent = problems ? t("tab.problemsN", { n: problems }) : t("tab.problems");
    this.tabs.kdp.textContent = t("tab.kdp");
    // The free edition's EPUB has no accessibility pack, so there is nothing to show.
    this.tabs.accessibility.hidden = FREE_EDITION;
    this.tabs.accessibility.textContent = audit && pro && !audit.passed ? t("tab.accessibilityFix") : pro || FREE_EDITION ? t("tab.accessibility") : t("tab.accessibilityPro");
  }

  /** What the publishing checklist needs from the built book; null before the first build. */
  publishFacts(): { problems: number; missingAlt: number; pages: number; spine: number } | null {
    if (!this.built) return null;
    const { book, layout, audit } = this.built;
    return {
      problems: this.problems().filter((p) => p.severity !== "info").length,
      missingAlt: audit.images.filter((i) => !i.ok).length,
      pages: layout.pages.length,
      spine: spineWidth(layout.pages.length, book.settings.paper),
    };
  }

  /** Show the Problems tab. */
  showProblems(): void {
    this.showTab("problems");
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
    const order: Tab[] = FREE_EDITION ? ["preview", "problems", "kdp"] : ["preview", "problems", "kdp", "accessibility"];
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
