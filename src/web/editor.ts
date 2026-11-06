// The chapter editor: a plain Markdown text box with a small toolbar (bold, italic, section title,
// scene break, footnote, quote), a word count and a "Saved" note. It only draws and reports typing;
// the workspace decides when and where the text is saved.

import { clear, h } from "../app/dom";
import { t, tn } from "../app/ui-i18n";
import { countWords, footnote, heading, lineOffset, quote, sceneBreak, wrap, type Edit } from "../project/edits";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface EditorDeps {
  /** Called after every change to the text. */
  input(body: string): void;
}

/** Put the new text in the box (only the part that changed), then tell the app it was edited. */
function applyEdit(ta: HTMLTextAreaElement, edit: Edit): void {
  const old = ta.value;
  let a = 0;
  while (a < old.length && a < edit.text.length && old[a] === edit.text[a]) a++;
  let b = 0;
  while (b < old.length - a && b < edit.text.length - a && old[old.length - 1 - b] === edit.text[edit.text.length - 1 - b]) b++;
  ta.focus();
  ta.setRangeText(edit.text.slice(a, edit.text.length - b), a, old.length - b, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.setSelectionRange(edit.start, edit.end);
}

export class ChapterEditor {
  private head = h("h2", { cls: "ed-heading", attr: { id: "ed-heading" } });
  private bar = h("div", { cls: "ed-bar", attr: { role: "toolbar", "aria-label": t("ed.toolbar") } });
  private area = h("textarea", { cls: "ed-text", attr: { id: "ed-text", spellcheck: "true", autocomplete: "off" } });
  private words = h("span", { cls: "ed-words" });
  private status = h("span", { cls: "ed-status", attr: { role: "status", "aria-live": "polite" } });
  private none = h("p", { cls: "ed-none", text: t("ed.none") });
  private body = h("div", { cls: "ed-body" });
  private showing = false;

  constructor(
    private box: HTMLElement,
    private deps: EditorDeps,
  ) {
    const tool = (label: string, aria: string, run: (ta: HTMLTextAreaElement) => Edit, extra: Record<string, string> = {}, cls?: string) =>
      h("button", { cls: ["ed-tool", cls], text: label, attr: { type: "button", "aria-label": aria, title: aria, ...extra }, on: { click: () => this.run(run) } });
    this.bar.append(
      tool(t("ed.bold"), t("ed.boldLabel"), (ta) => wrap(ta.value, ta.selectionStart, ta.selectionEnd, "**"), { "aria-keyshortcuts": "Control+B" }, "is-bold"),
      tool(t("ed.italic"), t("ed.italicLabel"), (ta) => wrap(ta.value, ta.selectionStart, ta.selectionEnd, "*"), { "aria-keyshortcuts": "Control+I" }, "is-italic"),
      tool(t("ed.title"), t("ed.titleLabel"), (ta) => heading(ta.value, ta.selectionStart, ta.selectionEnd)),
      tool(t("ed.scene"), t("ed.sceneLabel"), (ta) => sceneBreak(ta.value, ta.selectionStart, ta.selectionEnd)),
      tool(t("ed.note"), t("ed.noteLabel"), (ta) => footnote(ta.value, ta.selectionStart, ta.selectionEnd)),
      tool(t("ed.quote"), t("ed.quoteLabel"), (ta) => quote(ta.value, ta.selectionStart, ta.selectionEnd)),
    );
    this.area.addEventListener("input", () => {
      this.updateWords();
      this.deps.input(this.area.value);
    });
    this.area.addEventListener("keydown", (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
      const key = ev.key.toLowerCase();
      if (key !== "b" && key !== "i") return;
      ev.preventDefault();
      this.run((ta) => wrap(ta.value, ta.selectionStart, ta.selectionEnd, key === "b" ? "**" : "*"));
    });
    this.body.append(this.bar, this.area, h("div", { cls: "ed-foot" }, this.words, this.status));
    this.box.append(this.head, this.body, this.none);
    this.clear();
  }

  private run(make: (ta: HTMLTextAreaElement) => Edit): void {
    applyEdit(this.area, make(this.area));
  }

  private updateWords(): void {
    this.words.textContent = tn("ed.words", countWords(this.area.value));
  }

  /** Show a chapter; `line` (from 1, in the chapter text) puts the cursor there. */
  show(title: string, body: string, language: string, line?: number): void {
    this.showing = true;
    this.head.textContent = t("ed.heading", { title });
    this.head.hidden = false;
    this.body.hidden = false;
    this.none.hidden = true;
    this.area.setAttribute("aria-label", t("ed.text", { title }));
    this.area.lang = language;
    if (this.area.value !== body) this.area.value = body;
    this.updateWords();
    if (line !== undefined) this.goToLine(line);
  }

  /** Show the "pick a chapter" message instead of the editor. */
  clear(): void {
    this.showing = false;
    this.head.hidden = true;
    this.body.hidden = true;
    this.none.hidden = false;
    this.area.value = "";
    this.setStatus("idle");
  }

  goToLine(line: number): void {
    const pos = lineOffset(this.area.value, Math.max(1, line));
    this.area.focus();
    this.area.setSelectionRange(pos, pos);
    const lh = parseFloat(getComputedStyle(this.area).lineHeight) || 22;
    this.area.scrollTop = Math.max(0, (line - 1) * lh - this.area.clientHeight / 2);
  }

  focus(): void {
    if (this.showing) this.area.focus();
  }

  get value(): string {
    return this.area.value;
  }

  setStatus(state: SaveState, error = ""): void {
    clear(this.status);
    this.status.classList.toggle("is-error", state === "error");
    this.status.textContent = state === "saving" ? t("ed.saving") : state === "saved" ? t("ed.saved") : state === "error" ? t("ed.saveFailed", { error }) : "";
  }
}
