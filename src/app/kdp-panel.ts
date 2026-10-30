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

const SEVERITY_WORD = { error: "Must fix", warning: "Check", info: "Note" } as const;

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
    const sec = h("section", { cls: "bs-section" }, h("h3", { text: "KDP preflight" }));
    append(sec, h("p", { text: "Checks the page count, margins, images, fonts and ISBN against KDP's rules, on the PDF Book Studio writes, before you upload it." }));
    if (!this.pro("preflight")) {
      append(sec, h("p", { cls: "bs-pro-note", text: "The preflight is part of Book Studio Pro." }), h("button", { cls: "mod-cta", text: "Get Pro", on: { click: () => this.ctx.openLicense() } }));
      return sec;
    }
    const run = h("button", { cls: "mod-cta", text: this.report ? "Check again" : "Check for KDP" });
    run.disabled = this.running;
    run.addEventListener("click", () => void this.runCheck(built));
    append(sec, h("div", { cls: "bs-bar" }, run));
    if (!this.report) return sec;
    const r = this.report;
    const verdict = r.ok ? (r.warnings ? `No blocking problems. ${r.warnings} thing${r.warnings === 1 ? "" : "s"} to check before you upload.` : "No problems found.") : `${r.errors} problem${r.errors === 1 ? "" : "s"} KDP is likely to reject.`;
    append(sec, h("p", { cls: ["bs-verdict", r.ok ? "is-pass" : "is-fail"], text: verdict }));
    if (r.findings.length) {
      const ul = h("ul", { cls: "bs-problems" });
      for (const f of r.findings) {
        const li = h("li", { cls: `is-${f.severity}` }, h("strong", { text: `${SEVERITY_WORD[f.severity]}: ` }), f.message);
        if (f.page) {
          const folio = f.page;
          append(li, " ", h("button", { cls: "bs-link", text: `Show page ${folio}`, on: { click: () => this.ctx.showPage(folio) } }));
        }
        ul.appendChild(li);
      }
      append(sec, ul);
    }
    append(
      sec,
      h("details", null, h("summary", { text: `${r.passed.length} checks passed` }), h("ul", null, ...r.passed.map((p) => h("li", { text: p.title })))),
      h("div", { cls: "bs-bar" }, h("button", { text: "Save report", on: { click: () => void this.saveReport(built, r) } })),
      h("p", { cls: "bs-where", text: PREFLIGHT_DISCLAIMER }),
    );
    return sec;
  }

  private async runCheck(built: Built): Promise<void> {
    if (!(await this.ctx.gate(this.pro("preflight") ? [] : [{ feature: "preflight", message: "The KDP preflight is part of Book Studio Pro." }]))) return;
    this.running = true;
    this.render();
    try {
      const fonts = await this.ctx.fonts();
      const pdf = (await exportPdf(built, fonts)).data;
      this.report = await runPreflight({ book: built.book, layout: built.layout, fonts, pdf });
      this.reportFor = built;
    } catch (e) {
      console.error("Book Studio:", e);
      this.ctx.host.notify(`The preflight couldn't run: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
      this.render();
    }
  }

  private async saveReport(built: Built, report: PreflightReport): Promise<void> {
    await this.ctx.write("Writing the preflight report…", async () => ({ name: `${bookSlug(built.book)}-kdp-preflight.html`, mime: "text/html", data: preflightReport(built.book, report, { generator: GENERATOR }) }));
  }

  // ── Cover ──

  private coverSection(built: Built): HTMLElement {
    const sec = h("section", { cls: "bs-section" }, h("h3", { text: "Paperback cover" }));
    const guidesOn = this.ctx.host.store.get<boolean>("coverGuides") ?? true;
    const cover = this.makeCover(built, guidesOn);
    if (!cover) return sec;
    const g = cover.geometry;
    const px = coverPixels(g);
    append(
      sec,
      h("p", {
        text: `KDP prints the cover from one flat sheet: back cover, spine and front cover with bleed. For ${g.pages} pages on ${PAPER_LABEL[g.paper]} the sheet is ${g.width.toFixed(3)} × ${g.height.toFixed(3)} in and the spine ${g.spine.toFixed(3)} in. A cover image would need ${px.width} × ${px.height} pixels for 300 ppi if it spans the whole sheet; a front-only image needs ${Math.ceil(g.frontBleed.w * 300)} × ${Math.ceil(g.frontBleed.h * 300)}.`,
      }),
    );
    const guides = h("input", { attr: { type: "checkbox", checked: guidesOn } });
    guides.addEventListener("change", () => {
      this.ctx.host.store.set("coverGuides", guides.checked);
      this.render();
    });
    const exp = h("button", { cls: "mod-cta", text: this.pro("cover") ? "Export cover PDF" : "Export cover PDF (Pro)" });
    exp.addEventListener("click", () => void this.exportCover(built));
    append(sec, h("div", { cls: "bs-bar" }, h("label", { cls: "bs-check" }, guides, "Guides: bleed, safe area, spine and barcode"), exp));
    const canvas = h("canvas", { cls: "bs-cover-canvas", attr: { role: "img", "aria-label": `Flat paperback cover, ${g.width.toFixed(2)} by ${g.height.toFixed(2)} inches` } });
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
      for (const f of cover.findings) ul.appendChild(h("li", { cls: `is-${f.severity}` }, h("strong", { text: `${SEVERITY_WORD[f.severity]}: ` }), f.message));
      append(sec, ul);
    }
    append(sec, h("p", { cls: "bs-where", text: "Set cover, back-blurb, author-bio, author-photo, tagline, cover-background and paper in the book note. If you add pages the spine grows, so export the cover again before you upload it." }));
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
    if (!(await this.ctx.gate(this.pro("cover") ? [] : [{ feature: "cover", message: "The full paperback cover is part of Book Studio Pro." }]))) return;
    await this.ctx.write("Writing the cover PDF…", async () => {
      const out = await exportCover(built, await this.ctx.fonts());
      return { name: out.name, mime: "application/pdf", data: out.data };
    });
  }

  // ── Metadata sheet ──

  private sheetSection(built: Built): HTMLElement {
    const sec = h("section", { cls: "bs-section" }, h("h3", { text: "KDP details sheet" }));
    append(sec, h("p", { text: "Everything KDP's details page asks for, taken from the book note, ready to paste." }));
    if (!this.pro("kdpSheet")) {
      append(sec, h("p", { cls: "bs-pro-note", text: "The KDP details sheet is part of Book Studio Pro." }), h("button", { text: "Get Pro", on: { click: () => this.ctx.openLicense() } }));
      return sec;
    }
    const sheet = buildKdpSheet(built.book, built.layout.pages.length);
    if (sheet.problems.length) append(sec, h("ul", { cls: "bs-problems" }, ...sheet.problems.map((p) => h("li", { cls: "is-warning" }, h("strong", { text: "Check: " }), p))));
    const rows = sheet.fields.map((f) =>
      h(
        "tr",
        null,
        h("th", { attr: { scope: "row" }, text: f.label }),
        h("td", null, h("pre", { cls: "bs-sheet-value", text: f.value || "(not set)" })),
        h("td", null, h("button", { text: "Copy", attr: { "aria-label": `Copy ${f.label}` }, on: { click: () => void this.copy(f.value, f.label) } })),
      ),
    );
    append(
      sec,
      h("table", { cls: "bs-table" }, h("thead", null, h("tr", null, h("th", { attr: { scope: "col" }, text: "Field" }), h("th", { attr: { scope: "col" }, text: "Value" }), h("th", { attr: { scope: "col" }, text: "Copy" }))), h("tbody", null, ...rows)),
      h("div", { cls: "bs-bar" }, h("button", { text: "Copy everything", on: { click: () => void this.copy(sheet.text, "The sheet") } })),
    );
    return sec;
  }

  private async copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.host.notify(`${what} copied.`);
    } catch {
      // Clipboard access can be refused; saving the text as a file still gets it to the person.
      void this.ctx.write("Saving the text…", async () => ({ name: "kdp-details.txt", mime: "text/plain", data: text }));
    }
  }
}
