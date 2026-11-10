// The first-book guide: four steps (upload, style, details, download) over the writing screen, for a person
// who has just dropped their Word file in. The step lives in the project (`onboarding`), so closing the tab and
// coming back picks up where they were. It draws and reports; the workspace saves and the studio builds.

import { clear, h } from "../app/dom";
import { t, tn, getLocale } from "../app/ui-i18n";
import { themeAllowed, type Plan } from "../engine/entitlements";
import { THEMES } from "../engine/themes";
import { DEFAULT_TRIM, TRIMS } from "../engine/trims";
import type { BuiltFacts, FixPlace } from "../project/checklist";
import { readDetails, setDetail, setSetting } from "../project/details";
import { onboardingOf, type Onboarding, type Project } from "../project/model";
import { renderChecklist } from "./publish";

export interface WizardDeps {
  project(): Project | null;
  /** A new version of the project (a step, a style, a detail). `layout` lists the settings that changed. */
  change(next: Project, layout?: string[]): void;
  plan(): Plan;
  /** A small picture of the first page of chapter one in a style; null when it can't be made. */
  thumbnail(project: Project, theme: string, trim: string, width: number): Promise<HTMLCanvasElement | null>;
  /** Open the full book-details form. */
  moreDetails(): void;
  download(kind: "pdf" | "cover" | "epub"): void;
  facts(): BuiltFacts | null;
  go(place: FixPlace): void;
}

const STEPS = [1, 2, 3, 4] as const;
const LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "ca", "gl", "nl"];
const THUMB_WIDTH = 110;

export class Wizard {
  /** What the Word import left out, shown on step 1 (kept for this visit only). */
  private report: string[] = [];
  private gen = 0;
  private checklist: HTMLElement | null = null;
  private shownStep: Onboarding | null = null;

  constructor(
    private box: HTMLElement,
    private deps: WizardDeps,
  ) {}

  /** Show the guide for the open book, or hide it when the book has none. */
  show(report?: string[]): void {
    if (report) this.report = report;
    this.render();
  }

  hide(): void {
    this.gen++;
    this.shownStep = null;
    this.box.hidden = true;
    clear(this.box);
  }

  /** The built book changed: bring the checklist of the last step up to date. */
  refresh(): void {
    const p = this.deps.project();
    if (!p || onboardingOf(p) !== 4 || !this.checklist) return;
    this.fillChecklist(p);
  }

  private step(): Onboarding {
    const p = this.deps.project();
    return p ? onboardingOf(p) : "done";
  }

  private go(step: Onboarding): void {
    const p = this.deps.project();
    if (!p) return;
    this.deps.change({ ...p, onboarding: step });
    this.render(true);
  }

  private render(focus = false): void {
    const p = this.deps.project();
    const step = p ? onboardingOf(p) : "done";
    if (!p || step === "done") return this.hide();
    const keepFocus = focus && step !== this.shownStep;
    this.shownStep = step;
    this.gen++;
    this.checklist = null;
    clear(this.box);
    this.box.hidden = false;
    const names = { 1: t("wiz.s1"), 2: t("wiz.s2"), 3: t("wiz.s3"), 4: t("wiz.s4") } as const;
    const bar = h(
      "ol",
      { cls: "wiz-steps" },
      ...STEPS.map((n) => {
        const li = h("li", { cls: ["wiz-step", n < step && "is-done", n === step && "is-current"] });
        if (n === step) li.setAttribute("aria-current", "step");
        li.append(h("span", { cls: "wiz-n", text: n < step ? "✓" : String(n), attr: { "aria-hidden": "true" } }), h("span", { text: names[n] }));
        if (n < step) li.append(h("span", { cls: "sr-only", text: ` (${t("wiz.done")})` }));
        return li;
      }),
    );
    const heading = h("h2", { cls: "wiz-title", text: t("wiz.stepOf", { n: step, name: names[step] }), attr: { id: "wiz-heading", tabindex: "-1" } });
    const body = h("div", { cls: "wiz-body" });
    const skip = h("button", { cls: "wiz-skip", text: t("wiz.skip"), attr: { type: "button", "aria-label": t("wiz.skipLabel"), id: "wiz-skip" }, on: { click: () => this.go("done") } });
    const back = step > 1 ? h("button", { text: t("wiz.back"), attr: { type: "button", id: "wiz-back" }, on: { click: () => this.go((step - 1) as Onboarding) } }) : null;
    const next = h("button", { cls: "mod-cta", text: step === 4 ? t("wiz.finish") : t("wiz.next"), attr: { type: "button", id: "wiz-next" }, on: { click: () => this.go(step === 4 ? "done" : ((step + 1) as Onboarding)) } });
    this.box.append(h("section", { cls: "wiz", attr: { "aria-labelledby": "wiz-heading", role: "region" } }, h("nav", { attr: { "aria-label": t("wiz.label") } }, bar), heading, body, h("div", { cls: "wiz-actions" }, back, next, skip)));
    if (step === 1) this.step1(body, p);
    else if (step === 2) this.step2(body, p);
    else if (step === 3) this.step3(body, p);
    else this.step4(body, p);
    if (keepFocus) heading.focus();
  }

  // ── Steps ──

  private step1(body: HTMLElement, p: Project): void {
    body.append(h("p", { cls: "wiz-lead", text: tn("wiz.chapters", p.chapters.length) }), h("p", { text: t("wiz.s1.help") }));
    if (this.report.length) body.append(h("ul", { cls: "wiz-report" }, ...this.report.map((l) => h("li", { text: l }))));
  }

  private step2(body: HTMLElement, p: Project): void {
    const plan = this.deps.plan();
    const current = p.settings.theme || "classic";
    const options = THEMES.filter((x) => themeAllowed(plan, x.id));
    const trim = p.settings.trim || DEFAULT_TRIM;
    const grid = h("div", { cls: "wiz-styles" });
    const fieldset = h("fieldset", { cls: "wiz-group" }, h("legend", { text: t("wiz.styleLegend") }), grid);
    const gen = this.gen;
    for (const th of options) {
      const input = h("input", { attr: { type: "radio", name: "wiz-theme", value: th.id, checked: th.id === current } });
      input.checked = th.id === current;
      input.addEventListener("change", () => {
        const now = this.deps.project();
        if (now && input.checked) this.deps.change(setSetting(now, "theme", th.id, Date.now()), ["theme"]);
      });
      const slot = h("span", { cls: "wiz-thumb", attr: { "aria-hidden": "true" } });
      grid.append(h("label", { cls: "wiz-style" }, h("span", { cls: "wiz-style-name" }, input, ` ${th.name}`), slot));
      void this.deps.thumbnail(p, th.id, trim, THUMB_WIDTH).then((canvas) => {
        if (canvas && gen === this.gen) slot.append(canvas);
      });
    }
    const select = h("select", { attr: { id: "wiz-trim", name: "trim" } }, ...TRIMS.map((x) => h("option", { attr: { value: x.id }, text: x.label })));
    select.value = trim;
    select.addEventListener("change", () => {
      const now = this.deps.project();
      if (now) this.deps.change(setSetting(now, "trim", select.value, Date.now()), ["trim"]);
    });
    body.append(h("p", { text: t("wiz.s2.help") }), fieldset, h("div", { cls: "wiz-field" }, h("label", { text: t("wiz.trim"), attr: { for: "wiz-trim" } }), select));
  }

  private step3(body: HTMLElement, p: Project): void {
    const d = readDetails(p);
    const field = (key: "title" | "author" | "language" | "description", control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, label: string) => {
      control.id = `wiz-${key}`;
      control.addEventListener("input", () => {
        const now = this.deps.project();
        if (now) this.deps.change(setDetail(now, key, control.value, Date.now()));
      });
      return h("div", { cls: "wiz-field" }, h("label", { text: label, attr: { for: control.id } }), control);
    };
    const text = (key: "title" | "author", value: string, label: string) => {
      const input = h("input", { attr: { type: "text", autocomplete: key === "author" ? "name" : "off" } });
      input.value = value;
      return field(key, input, label);
    };
    const names = new Intl.DisplayNames([getLocale()], { type: "language" });
    const code = d.language.trim() || "en";
    const lang = h("select", null, ...LANGUAGES.map((l) => h("option", { attr: { value: l, lang: l }, text: names.of(l) ?? l })), LANGUAGES.includes(code) ? null : h("option", { attr: { value: code }, text: code }));
    lang.value = code;
    const description = h("textarea", { attr: { rows: "3" } });
    description.value = d.description;
    body.append(
      h("p", { text: t("wiz.s3.help") }),
      text("title", d.title, t("dt.f.title")),
      text("author", d.author, t("dt.f.author")),
      field("language", lang, t("dt.f.language")),
      field("description", description, t("dt.f.description")),
      h("p", null, h("button", { text: t("wiz.more"), attr: { type: "button", id: "wiz-more" }, on: { click: () => this.deps.moreDetails() } })),
    );
  }

  private step4(body: HTMLElement, p: Project): void {
    const button = (label: string, kind: "pdf" | "cover" | "epub", primary = false) => h("button", { cls: primary ? "mod-cta" : undefined, text: label, attr: { type: "button" }, on: { click: () => this.deps.download(kind) } });
    this.checklist = h("div", { cls: "wiz-checklist" });
    body.append(h("p", { text: t("wiz.s4.help") }), h("div", { cls: "wiz-downloads" }, button(t("wiz.dlPdf"), "pdf", true), button(t("wiz.dlCover"), "cover"), button(t("wiz.dlEpub"), "epub")), this.checklist);
    this.fillChecklist(p);
  }

  private fillChecklist(p: Project): void {
    if (!this.checklist) return;
    clear(this.checklist);
    this.checklist.append(...renderChecklist(p, this.deps.facts(), (place) => this.deps.go(place)));
  }
}
