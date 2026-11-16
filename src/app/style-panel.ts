// The "Style" panel: size, line spacing, margins, indent, drop cap and scene ornament of the style a book uses.
// It writes the changes through `change` (the studio stores them with the book's settings) 300 ms after the last
// edit; "Reset" removes them. Limits are applied by resolveTheme(), so the fields show the value the book really uses.

import { setStyleField, minInsideMargin, type StyleField } from "../engine/style-ops";
import type { StyleOverrides } from "../engine/model";
import { ORNAMENTS } from "../engine/ornaments";
import { resolveTheme, sizeRange } from "../engine/themes";
import { h, select } from "./dom";
import type { Built } from "./pipeline";
import { t } from "./ui-i18n";

const PT = 72;
const DELAY = 300;

const GLYPHS = ["❦", "❧", "* * *"];

export class StylePanel {
  readonly root: HTMLDetailsElement;
  private body = h("div", { cls: "bs-style-body" });
  private inputs = new Map<StyleField, HTMLInputElement | HTMLSelectElement>();
  private warning = h("p", { cls: "bs-style-warning", attr: { role: "status" } });
  private pending: StyleOverrides | undefined | null = null;
  private timer: number | undefined;
  private style: StyleOverrides | undefined;
  private minInside = 0;

  constructor(private change: (style: StyleOverrides | undefined) => void) {
    this.root = h("details", { cls: "bs-style" }, h("summary", { text: t("sty.title") }), this.body);
    this.build();
  }

  private number(field: StyleField, label: string, step: string): HTMLLabelElement {
    const input = h("input", { attr: { type: "number", step, inputmode: "decimal" } });
    input.addEventListener("input", () => {
      const v = input.value.trim() === "" ? undefined : Number(input.value.replace(",", "."));
      this.edit(field, v !== undefined && Number.isFinite(v) ? v : undefined);
    });
    this.inputs.set(field, input);
    return h("label", { cls: "bs-field" }, h("span", { text: label }), input);
  }

  private build(): void {
    const dropCap = select(
      [
        { value: "0", label: t("sty.dropNone") },
        { value: "2", label: t("sty.drop2") },
        { value: "3", label: t("sty.drop3") },
      ],
      "0",
      { on: { change: () => this.edit("dropCap", Number(dropCap.value)) } },
    );
    this.inputs.set("dropCap", dropCap);
    const scene = select(
      [{ value: "", label: t("sty.sceneOwn") }, ...GLYPHS.map((g) => ({ value: g, label: g })), ...ORNAMENTS.map((o) => ({ value: `ornament:${o.id}`, label: o.name }))],
      "",
      { on: { change: () => this.edit("sceneBreak", scene.value || undefined) } },
    );
    this.inputs.set("sceneBreak", scene);
    const minButton = h("button", { text: t("sty.setMin"), attr: { type: "button" }, on: { click: () => this.edit("inside", this.minInside, true) } });
    minButton.className = "bs-style-min";
    this.warningButton = minButton;
    const reset = h("button", { text: t("sty.reset"), attr: { type: "button" }, on: { click: () => this.reset() } });
    this.body.append(
      this.number("size", t("sty.size"), "0.5"),
      this.number("leading", t("sty.leading"), "0.05"),
      this.number("top", t("sty.top"), "0.05"),
      this.number("bottom", t("sty.bottom"), "0.05"),
      this.number("outside", t("sty.outside"), "0.05"),
      this.number("inside", t("sty.inside"), "0.05"),
      this.number("indent", t("sty.indent"), "0.1"),
      h("label", { cls: "bs-field" }, h("span", { text: t("sty.dropCap") }), dropCap),
      h("label", { cls: "bs-field" }, h("span", { text: t("sty.scene") }), scene),
      reset,
      this.warning,
    );
  }

  private warningButton!: HTMLButtonElement;

  private edit(field: StyleField, value: number | string | undefined, now = false): void {
    this.style = setStyleField(this.pending !== null ? this.pending : this.style, field, value);
    this.pending = this.style;
    window.clearTimeout(this.timer);
    if (now) this.flush();
    else this.timer = window.setTimeout(() => this.flush(), DELAY);
  }

  private reset(): void {
    window.clearTimeout(this.timer);
    this.pending = null;
    this.style = undefined;
    this.change({});
  }

  private flush(): void {
    if (this.pending === null) return;
    const style = this.pending;
    this.pending = null;
    this.change(style ?? {});
  }

  /** Show the values the book uses now. A field being typed in keeps what is typed. */
  update(built: Built): void {
    const settings = built.book.settings;
    this.style = settings.style;
    const theme = resolveTheme(settings);
    const range = sizeRange(theme.id);
    const set = (field: StyleField, value: string) => {
      const el = this.inputs.get(field);
      if (el && el !== document.activeElement) el.value = value;
    };
    const num = (n: number, digits = 2) => String(+n.toFixed(digits));
    set("size", num(theme.body.size));
    set("leading", num(theme.body.leading / theme.body.size));
    set("top", num(theme.margins.top));
    set("bottom", num(theme.margins.bottom));
    set("outside", num(theme.margins.outside));
    set("inside", num(theme.margins.inside));
    set("indent", num(theme.body.indent, 1));
    set("dropCap", String(theme.firstParagraph.dropCap));
    set("sceneBreak", settings.style?.sceneBreak ?? "");
    const size = this.inputs.get("size") as HTMLInputElement;
    size.min = String(range.min);
    size.max = String(range.max);
    const leading = this.inputs.get("leading") as HTMLInputElement;
    leading.min = "1.2";
    leading.max = "1.5";
    // The book raises the inside margin when KDP asks for more at this page count: say so next to the control.
    const used = built.layout.margins.inside / PT;
    this.minInside = minInsideMargin(built.layout.pages.length);
    const short = theme.margins.inside < this.minInside - 0.0005;
    this.warning.textContent = short ? t("sty.kdpMin", { min: String(+this.minInside.toFixed(3)), pages: built.layout.pages.length, used: String(+used.toFixed(3)) }) : "";
    if (short) this.warning.append(" ", this.warningButton);
  }
}
