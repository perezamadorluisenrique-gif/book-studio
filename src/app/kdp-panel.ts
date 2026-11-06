// The KDP tab: the preflight, the full paperback cover and the metadata sheet.
// Seeing them is always free; running the preflight, exporting the cover and the
// sheet are part of Pro.

import { FREE_EDITION } from "../config";
import { composeCover } from "../engine/cover/cover";
import { bookSlug } from "../engine/epub";
import { coverPixels, PAPER_LABEL } from "../engine/cover/geometry";
import { hasFeature, type ExportBlocker, type Plan } from "../engine/entitlements";
import type { FontSet } from "../engine/fonts";
import { buildKdpSheet } from "../engine/kdp-sheet";
import { PREFLIGHT_DISCLAIMER, runPreflight, type PreflightReport } from "../engine/preflight";
import { preflightReport } from "../engine/preflight-report";
import type { PagePainter } from "../preview/canvas";
import { append, clear, h } from "./dom";
import type { StudioHost } from "./host";
import { exportCover, exportPdf, GENERATOR, type Built } from "./pipeline";
import { t, tn } from "./ui-i18n";

export interface KdpContext {
  host: StudioHost;
  plan(): Plan;
  built(): Built | null;
  fonts(): Promise<FontSet>;
  painter(): PagePainter | null;
  /** Ask before something the plan doesn't include; resolves true to go ahead. */
  gate(blockers: ExportBlocker[]): Promise<boolean>;
  write(message: string, make: () => Promise<{ name: string; mime: string; data: Uint8Array | string }>): Promise<void>;
  showPage(folio: string): void;
  openLicense(): void;
}

const severityWord = (s: "error" | "warning" | "info"): string => t(`kdp.sev.${s}`);

export class KdpPanel {
  private report: PreflightReport | null = null;
  /** The book the report is for, so a rebuild clears a stale one. */
  private reportFor: Built | null = null;
  private running = false;
  private coverGen = 0;

  constructor(
    private panel: HTMLElement,
    private ctx: KdpContext,
  ) {}

  private pro(feature: "preflight" | "cover" | "kdpSheet"): boolean {
    return hasFeature(this.ctx.plan(), feature);
  }

  render(): void {
    const built = this.ctx.built();
    clear(this.panel);
    if (!built || FREE_EDITION) return;
    if (this.reportFor !== built) {
      this.report = null;
      this.reportFor = built;
    }
    this.coverGen++;
    append(this.panel, this.preflightSection(built), this.coverSection(built), this.sheetSection(built));
  }

  // ── Preflight ──

  private preflightSection(built: Built): HTMLElement {
    const sec = h("section", { cls: "bs-section" }, h("h3", { text: t("kdp.preflightTitle") }));
    append(sec, h("p", { text: t("kdp.preflightIntro") }));
    if (!this.pro("preflight")) {
      append(sec, h("p", { cls: "bs-pro-note", text: t("kdp.preflightPro") }), h("button", { cls: "mod-cta", text: t("kdp.getPro"), on: { click: () => this.ctx.openLicense() } }));
      return sec;
    }
    const run = h("button", { cls: "mod-cta", text: this.report ? t("kdp.checkAgain") : t("kdp.check") });
    run.disabled = this.running;
    run.addEventListener("click", () => void this.runCheck(built));
    append(sec, h("div", { cls: "bs-bar" }, run));
    if (!this.report) return sec;
    const r = this.report;
    const verdict = r.ok ? (r.warnings ? tn("kdp.verdictWarn", r.warnings) : t("kdp.verdictOk")) : tn("kdp.verdictFail", r.errors);
    append(sec, h("p", { cls: ["bs-verdict", r.ok ? "is-pass" : "is-fail"], text: verdict }));
    if (r.findings.length) {
      const ul = h("ul", { cls: "bs-problems" });
      for (const f of r.findings) {
        const li = h("li", { cls: `is-${f.severity}` }, h("strong", { text: `${severityWord(f.severity)}: ` }), f.message);
        if (f.page) {
          const folio = f.page;
          append(li, " ", h("button", { cls: "bs-link", text: t("kdp.showPage", { folio }), on: { click: () => this.ctx.showPage(folio) } }));
        }
        ul.appendChild(li);
      }
      append(sec, ul);
    }
    append(
      sec,
      h("details", null, h("summary", { text: t("kdp.passed", { n: r.passed.length }) }), h("ul", null, ...r.passed.map((p) => h("li", { text: p.title })))),
      h("div", { cls: "bs-bar" }, h("button", { text: t("kdp.saveReport"), on: { click: () => void this.saveReport(built, r) } })),
      h("p", { cls: "bs-where", text: PREFLIGHT_DISCLAIMER }),
    );
    return sec;
  }

  private async runCheck(built: Built): Promise<void> {
    if (!(await this.ctx.gate(this.pro("preflight") ? [] : [{ feature: "preflight", message: t("kdp.preflightGate") }]))) return;
    this.running = true;
    this.render();
    try {
      const fonts = await this.ctx.fonts();
      const pdf = (await exportPdf(built, fonts)).data;
      this.report = await runPreflight({ book: built.book, layout: built.layout, fonts, pdf });
      this.reportFor = built;
    } catch (e) {
      console.error("Book Studio:", e);
      this.ctx.host.notify(t("kdp.preflightFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      this.running = false;
      this.render();
    }
  }

  private async saveReport(built: Built, report: PreflightReport): Promise<void> {
    await this.ctx.write(t("kdp.writingReport"), async () => ({ name: `${bookSlug(built.book)}-kdp-preflight.html`, mime: "text/html", data: preflightReport(built.book, report, { generator: GENERATOR }) }));
  }

  // ── Cover ──

  private coverSection(built: Built): HTMLElement {
    const sec = h("section", { cls: "bs-section" }, h("h3", { text: t("kdp.coverTitle") }));
    const guidesOn = this.ctx.host.store.get<boolean>("coverGuides") ?? true;
    const cover = this.makeCover(built, guidesOn);
    if (!cover) return sec;
    const g = cover.geometry;
    const px = coverPixels(g);
    append(
      sec,
      h("p", {
        text: t("kdp.coverIntro", { pages: g.pages, paper: PAPER_LABEL[g.paper], width: g.width.toFixed(3), height: g.height.toFixed(3), spine: g.spine.toFixed(3), pxW: px.width, pxH: px.height, frontW: Math.ceil(g.frontBleed.w * 300), frontH: Math.ceil(g.frontBleed.h * 300) }),
      }),
    );
    const guides = h("input", { attr: { type: "checkbox", checked: guidesOn } });
    guides.addEventListener("change", () => {
      this.ctx.host.store.set("coverGuides", guides.checked);
      this.render();
    });
    const exp = h("button", { cls: "mod-cta", text: this.pro("cover") ? t("kdp.exportCover") : t("kdp.exportCoverPro") });
    exp.addEventListener("click", () => void this.exportCover(built));
    append(sec, h("div", { cls: "bs-bar" }, h("label", { cls: "bs-check" }, guides, t("kdp.coverGuides")), exp));
    const canvas = h("canvas", { cls: "bs-cover-canvas", attr: { role: "img", "aria-label": t("kdp.coverAria", { width: g.width.toFixed(2), height: g.height.toFixed(2) }) } });
    append(sec, h("div", { cls: "bs-cover" }, canvas));
    const painter = this.ctx.painter();
    const gen = this.coverGen;
    window.requestAnimationFrame(() => {
      if (gen !== this.coverGen || !painter) return;
      const width = Math.max(Math.min(canvas.parentElement?.clientWidth || 800, 1100), 320);
      const scale = width / cover.layout.widthPt;
      canvas.style.width = `${Math.round(width)}px`;
      canvas.style.height = `${Math.round(cover.layout.heightPt * scale)}px`;
      void painter.paint(canvas, cover.layout, cover.layout.pages[0], { scale, dpr: Math.min(window.devicePixelRatio || 1, 2), paper: "#ffffff" });
    });
    if (cover.findings.length) {
      const ul = h("ul", { cls: "bs-problems" });
      for (const f of cover.findings) ul.appendChild(h("li", { cls: `is-${f.severity}` }, h("strong", { text: `${severityWord(f.severity)}: ` }), f.message));
      append(sec, ul);
    }
    append(sec, h("p", { cls: "bs-where", text: t("kdp.coverHelp") }));
    return sec;
  }

  private makeCover(built: Built, guides: boolean) {
    // The fonts are loaded by the time a book is built, so the cover can be composed in place.
    const fonts = this.fontsNow;
    if (!fonts) return null;
    return composeCover(built.book, fonts, built.layout.pages.length, { guides });
  }

  /** Set by the studio once the fonts have loaded. */
  fontsNow: FontSet | null = null;

  private async exportCover(built: Built): Promise<void> {
    if (!(await this.ctx.gate(this.pro("cover") ? [] : [{ feature: "cover", message: t("kdp.coverGate") }]))) return;
    await this.ctx.write(t("kdp.writingCover"), async () => {
      const out = await exportCover(built, await this.ctx.fonts());
      return { name: out.name, mime: "application/pdf", data: out.data };
    });
  }

  // ── Metadata sheet ──

  private sheetSection(built: Built): HTMLElement {
    const sec = h("section", { cls: "bs-section" }, h("h3", { text: t("kdp.sheetTitle") }));
    append(sec, h("p", { text: t("kdp.sheetIntro") }));
    if (!this.pro("kdpSheet")) {
      append(sec, h("p", { cls: "bs-pro-note", text: t("kdp.sheetPro") }), h("button", { text: t("kdp.getPro"), on: { click: () => this.ctx.openLicense() } }));
      return sec;
    }
    const sheet = buildKdpSheet(built.book, built.layout.pages.length);
    if (sheet.problems.length) append(sec, h("ul", { cls: "bs-problems" }, ...sheet.problems.map((p) => h("li", { cls: "is-warning" }, h("strong", { text: `${t("kdp.sev.warning")}: ` }), p))));
    const rows = sheet.fields.map((f) =>
      h(
        "tr",
        null,
        h("th", { attr: { scope: "row" }, text: f.label }),
        h("td", null, h("pre", { cls: "bs-sheet-value", text: f.value || t("kdp.notSet") })),
        h("td", null, h("button", { text: t("kdp.copy"), attr: { "aria-label": t("kdp.copyField", { field: f.label }) }, on: { click: () => void this.copy(f.value, f.label) } })),
      ),
    );
    append(
      sec,
      h("table", { cls: "bs-table" }, h("thead", null, h("tr", null, h("th", { attr: { scope: "col" }, text: t("kdp.colField") }), h("th", { attr: { scope: "col" }, text: t("kdp.colValue") }), h("th", { attr: { scope: "col" }, text: t("kdp.colCopy") }))), h("tbody", null, ...rows)),
      h("div", { cls: "bs-bar" }, h("button", { text: t("kdp.copyAll"), on: { click: () => void this.copy(sheet.text, t("kdp.theSheet")) } })),
    );
    return sec;
  }

  private async copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.host.notify(t("kdp.copied", { what }));
    } catch {
      // Clipboard access can be refused; saving the text as a file still gets it to the person.
      void this.ctx.write(t("kdp.savingText"), async () => ({ name: "kdp-details.txt", mime: "text/plain", data: text }));
    }
  }
}
