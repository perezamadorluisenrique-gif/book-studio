// The "Book: details" form of the web app: title, author, ISBN, keywords, theme, trim size and the front
// cover picture. It draws the form and reports each change as a new project; the workspace saves it.

import { clear, h } from "../app/dom";
import { t, getLocale } from "../app/ui-i18n";
import { FREE_EDITION } from "../config";
import { themeAllowed, type Plan } from "../engine/entitlements";
import { THEMES } from "../engine/themes";
import { DEFAULT_TRIM, trimById, TRIMS } from "../engine/trims";
import { coverAsset, frontCoverPixels, imageSize, MAX_COVER_BYTES, removeCover, setCover, sniffImage } from "../project/cover-image";
import { isbnProblem, keywordsValue, MAX_KEYWORDS, parseKeywords, readDetails, setDetail, setSetting, type DetailField } from "../project/details";
import type { Project } from "../project/model";

export interface DetailsDeps {
  plan(): Plan;
  /** The project as it is now (the chapter list can change it while this form is open). */
  current(): Project | null;
  /** The form made a new version of the project. `layout` lists the settings it changed (theme, trim). */
  change(next: Project, layout?: string[]): void;
  notify(message: string): void;
}

const LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "ca", "gl", "nl"];

interface TextField {
  field: DetailField;
  kind: "input" | "textarea";
  hint?: () => string;
  auto?: string;
}

const GROUPS: { title: string; fields: TextField[] }[] = [
  {
    title: "dt.sectionText",
    fields: [
      { field: "title", kind: "input" },
      { field: "subtitle", kind: "input" },
      { field: "author", kind: "input", hint: () => t("dt.f.authorHint"), auto: "name" },
    ],
  },
  {
    title: "dt.sectionPublish",
    fields: [
      { field: "publisher", kind: "input" },
      { field: "isbnPrint", kind: "input", hint: () => t("dt.f.isbnHint") },
      { field: "isbnEbook", kind: "input", hint: () => t("dt.f.isbnHint") },
      { field: "series", kind: "input" },
      { field: "keywords", kind: "input", hint: () => t("dt.f.keywordsHint", { max: MAX_KEYWORDS }) },
      { field: "description", kind: "textarea", hint: () => t("dt.f.descriptionHint") },
    ],
  },
  {
    title: "dt.sectionFront",
    fields: [
      { field: "copyright", kind: "input", hint: () => t("dt.f.copyrightHint") },
      { field: "dedication", kind: "textarea" },
      { field: "epigraph", kind: "textarea" },
    ],
  },
];

export class DetailsForm {
  private heading = h("h2", { cls: "dt-heading", attr: { id: "dt-heading", tabindex: -1 } });
  private coverBox = h("div", { cls: "dt-cover" });
  private live = h("p", { cls: "sr-only", attr: { role: "status", "aria-live": "polite" } });
  private thumb: string | null = null;
  private fileInput: HTMLInputElement | null = null;

  constructor(private box: HTMLElement, private deps: DetailsDeps) {}

  private get project(): Project | null {
    return this.deps.current();
  }

  /** Draw the form for this project. */
  show(): void {
    const project = this.project;
    if (!project) return;
    this.release();
    clear(this.box);
    const form = h("form", { cls: "dt", attr: { "aria-labelledby": "dt-heading", novalidate: true, autocomplete: "off" }, on: { submit: (ev) => ev.preventDefault() } });
    this.heading.textContent = t("dt.title");
    form.append(this.heading, h("p", { cls: "dt-intro", text: t("dt.intro") }));
    const d = readDetails(project);
    for (const g of GROUPS) {
      const set = h("fieldset", { cls: "dt-group" }, h("legend", { text: t(g.title as "dt.sectionText") }));
      if (g.title === "dt.sectionText") {
        set.append(this.textField(g.fields[0], d.title), this.textField(g.fields[1], d.subtitle), this.textField(g.fields[2], d.author), this.languageField(d.language));
      } else {
        for (const f of g.fields) set.append(this.textField(f, d[f.field]));
      }
      form.append(set);
    }
    form.append(this.layoutGroup(project), this.coverGroup());
    this.box.append(form, this.live);
    this.drawCover();
    // Show the problems the typed values already have.
    for (const f of ["isbnPrint", "isbnEbook", "keywords"] as const) this.check(f, d[f]);
  }

  /** Put the focus at the top of the form. */
  focus(): void {
    this.heading.focus();
  }

  /** Free the picture preview (when the form is hidden or drawn again). */
  release(): void {
    if (this.thumb) URL.revokeObjectURL(this.thumb);
    this.thumb = null;
  }

  // ── Fields ──

  private id(name: string): string {
    return `dt-${name}`;
  }

  private textField(f: TextField, value: string): HTMLElement {
    const id = this.id(f.field);
    const label = t(`dt.f.${f.field}` as "dt.f.title");
    const common = { id, name: f.field, "aria-describedby": `${id}-hint ${id}-err` };
    const control =
      f.kind === "textarea"
        ? h("textarea", { cls: "dt-input", attr: { ...common, rows: 3 } })
        : h("input", { cls: "dt-input", attr: { ...common, type: "text", autocomplete: f.auto } });
    control.value = f.field === "keywords" ? parseKeywords(value).all.join(", ") : value;
    control.addEventListener("input", () => this.typed(f.field, control.value));
    return h(
      "div",
      { cls: "dt-field" },
      h("label", { text: label, attr: { for: id } }),
      control,
      h("p", { cls: "dt-hint", text: f.hint?.() ?? "", attr: { id: `${id}-hint` } }),
      h("p", { cls: "dt-err", attr: { id: `${id}-err` } }),
    );
  }

  private languageField(value: string): HTMLElement {
    const id = this.id("language");
    const names = new Intl.DisplayNames([getLocale()], { type: "language" });
    const code = value.trim() || "en";
    const known = LANGUAGES.includes(code);
    const select = h(
      "select",
      { cls: "dt-input", attr: { id, name: "language" }, on: { change: () => this.typed("language", select.value) } },
      ...LANGUAGES.map((l) => h("option", { attr: { value: l, lang: l }, text: names.of(l) ?? l })),
      known ? null : h("option", { attr: { value: code }, text: t("dt.langOther", { code }) }),
    );
    select.value = code;
    return h("div", { cls: "dt-field" }, h("label", { text: t("dt.f.language"), attr: { for: id } }), select);
  }

  private layoutGroup(project: Project): HTMLElement {
    const plan = this.deps.plan();
    const theme = project.settings.theme || "classic";
    const trim = project.settings.trim || DEFAULT_TRIM;
    const make = (id: string, label: string, key: string, current: string, options: { value: string; label: string; ok: boolean }[]) => {
      const visible = options.filter((o) => !FREE_EDITION || o.ok || o.value === current);
      const select = h(
        "select",
        { cls: "dt-input", attr: { id, name: key }, on: { change: () => this.layout(key, select.value) } },
        ...visible.map((o) => h("option", { attr: { value: o.value, disabled: !o.ok && o.value !== current }, text: o.ok ? o.label : `${o.label} (${t("set.pro")})` })),
      );
      select.value = current;
      return h("div", { cls: "dt-field" }, h("label", { text: label, attr: { for: id } }), select);
    };
    return h(
      "fieldset",
      { cls: "dt-group" },
      h("legend", { text: t("dt.sectionLayout") }),
      make(this.id("theme"), t("dt.f.theme"), "theme", theme, THEMES.map((x) => ({ value: x.id, label: x.name, ok: themeAllowed(plan, x.id) }))),
      make(this.id("trim"), t("dt.f.trim"), "trim", trim, TRIMS.map((x) => ({ value: x.id, label: x.label, ok: true }))),
    );
  }

  private layout(key: string, value: string): void {
    if (!this.project) return;
    this.deps.change(setSetting(this.project, key, value, Date.now()), [key]);
    if (key === "trim") this.drawCover();
  }

  private typed(field: DetailField, value: string): void {
    if (!this.project) return;
    this.check(field, value);
    this.deps.change(setDetail(this.project, field, field === "keywords" ? keywordsValue(value) : value, Date.now()));
  }

  /** Show or clear the error of a field, for the screen and for screen readers. */
  private check(field: DetailField, value: string): void {
    let message = "";
    if (field === "isbnPrint" || field === "isbnEbook") {
      const problem = isbnProblem(value);
      if (problem) message = t(`dt.err.${problem}` as "dt.err.format");
    } else if (field === "keywords") {
      const k = parseKeywords(value);
      if (k.tooMany) message = t("dt.err.keywords", { n: k.all.length, max: MAX_KEYWORDS });
    } else return;
    const input = this.box.querySelector<HTMLElement>(`#${this.id(field)}`);
    const err = this.box.querySelector<HTMLElement>(`#${this.id(field)}-err`);
    if (!input || !err) return;
    err.textContent = message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  // ── Cover ──

  private coverGroup(): HTMLElement {
    const id = this.id("cover-file");
    this.fileInput = h("input", {
      cls: "dt-input",
      attr: { id, name: "cover", type: "file", accept: "image/jpeg,image/png", "aria-describedby": "dt-cover-hint" },
      on: { change: () => void this.pickFile() },
    });
    return h(
      "fieldset",
      { cls: "dt-group" },
      h("legend", { text: t("dt.sectionCover") }),
      h("div", { cls: "dt-field" }, h("label", { text: t("dt.cover.file"), attr: { for: id } }), this.fileInput, h("p", { cls: "dt-hint", attr: { id: "dt-cover-hint" }, text: t("dt.cover.hint", { max: MAX_COVER_BYTES / 1024 / 1024 }) })),
      this.coverBox,
    );
  }

  private async pickFile(): Promise<void> {
    const file = this.fileInput?.files?.[0];
    if (!file || !this.project) return;
    const fail = (message: string) => {
      this.showCoverError(message);
      if (this.fileInput) this.fileInput.value = "";
    };
    if (file.size > MAX_COVER_BYTES) return fail(t("dt.cover.tooBig", { mb: (file.size / 1024 / 1024).toFixed(1), max: MAX_COVER_BYTES / 1024 / 1024 }));
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const mime = sniffImage(data);
      if (!mime) return fail(t("dt.cover.badType"));
      if (!this.project) return;
      this.deps.change(setCover(this.project, data, mime, Date.now()));
      this.drawCover();
      this.say(t("dt.cover.added"));
    } catch (e) {
      fail(t("dt.cover.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private say(message: string): void {
    this.live.textContent = "";
    window.setTimeout(() => (this.live.textContent = message), 30);
  }

  private showCoverError(message: string): void {
    const err = this.coverBox.querySelector(".dt-err");
    if (err) err.textContent = message;
    else this.coverBox.prepend(h("p", { cls: "dt-err", text: message }));
    this.say(message);
  }

  /** Draw the preview of the cover, its size and the size print needs. */
  private drawCover(): void {
    this.release();
    clear(this.coverBox);
    const p = this.project;
    if (!p) return;
    const trim = trimById(p.settings.trim || DEFAULT_TRIM) ?? TRIMS[0];
    const need = frontCoverPixels(trim.id);
    const asset = coverAsset(p);
    this.coverBox.append(h("p", { cls: "dt-hint", text: t("dt.cover.pixels", { trim: trim.label, w: need.width, h: need.height }) }), h("p", { cls: "dt-err", attr: { role: "status" } }));
    if (!asset) {
      this.coverBox.append(h("p", { cls: "dt-none", text: t("dt.cover.none") }));
      return;
    }
    this.thumb = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mime }));
    const title = p.meta.title?.trim() || p.name;
    const size = imageSize(asset.data);
    const small = size && (size.width < need.width || size.height < need.height);
    const note = size ? (small ? t("dt.cover.small", { w: size.width, h: size.height, needW: need.width, needH: need.height }) : t("dt.cover.size", { w: size.width, h: size.height })) : "";
    this.coverBox.append(
      h(
        "div",
        { cls: "dt-cover-row" },
        h("img", { cls: "dt-thumb", attr: { src: this.thumb, alt: t("dt.cover.alt", { title }), width: 96 } }),
        h("div", null, note ? h("p", { cls: small ? "dt-warn" : "dt-hint", text: note }) : null, h("button", { text: t("dt.cover.remove"), attr: { type: "button", "aria-label": t("dt.cover.removeLabel") }, on: { click: () => this.remove() } })),
      ),
    );
  }

  private remove(): void {
    if (!this.project) return;
    this.deps.change(removeCover(this.project, Date.now()));
    if (this.fileInput) this.fileInput.value = "";
    this.drawCover();
    this.say(t("dt.cover.removed"));
    this.fileInput?.focus();
  }
}
