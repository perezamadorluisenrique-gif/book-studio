// The list of chapters in the web app: three groups (front matter, chapters, back matter) where you
// pick a chapter, add one, rename, delete, and put them in order by dragging or with buttons / Alt+Up and Alt+Down.
// It draws the list and calls back; the workspace changes the project and saves it.

import { append, clear, h } from "../app/dom";
import type { Dialog } from "../app/host";
import { t } from "../app/ui-i18n";
import { SECTION_ORDER, type Project, type SectionKind } from "../project/model";
import { chapterById } from "../project/model";
import { bookOrder, sectionIds } from "../project/ops";

export interface ChapterListDeps {
  pick(id: string): void;
  add(kind: SectionKind): void;
  startRename(id: string): void;
  rename(id: string, title: string): void;
  cancelRename(id: string): void;
  remove(id: string): void;
  /** Move one place (-1 up, 1 down). */
  move(id: string, delta: -1 | 1): void;
  /** Put a chapter in a section at a place (after taking it out of where it was). */
  drop(id: string, kind: SectionKind, index: number): void;
  ask(d: Dialog): Promise<"ok" | "cancel" | "extra">;
}

export interface ListState {
  project: Project;
  /** The chapter being written. */
  active: string | null;
  /** The chapter whose name is being changed. */
  renaming: string | null;
}

export type ListFocus = { id: string; part: "pick" | "rename" | "up" | "down" } | { kind: SectionKind; part: "add" };

export const sectionLabel = (k: SectionKind): string => t(k === "front" ? "ch.front" : k === "body" ? "ch.body" : "ch.back");

export class ChapterList {
  private live = h("p", { cls: "sr-only", attr: { role: "status", "aria-live": "polite" } });
  private dragging: string | null = null;

  constructor(
    private box: HTMLElement,
    private deps: ChapterListDeps,
  ) {}

  /** Say something to screen readers (for example where a chapter went). */
  announce(message: string): void {
    this.live.textContent = "";
    // A short pause makes the reader say the same message twice in a row.
    window.setTimeout(() => (this.live.textContent = message), 30);
  }

  render(state: ListState, focus?: ListFocus): void {
    clear(this.box);
    append(this.box, h("h2", { cls: "ch-title", text: t("ch.title") }), h("p", { cls: "ch-hint", attr: { id: "ch-hint" }, text: t("ch.hint") }));
    for (const kind of SECTION_ORDER) this.box.appendChild(this.group(state, kind));
    this.box.appendChild(this.live);
    if (focus) this.focusOn(focus);
  }

  private focusOn(f: ListFocus): void {
    if ("kind" in f) {
      this.box.querySelector<HTMLElement>(`[data-add="${f.kind}"]`)?.focus();
      return;
    }
    const row = `[data-id="${CSS.escape(f.id)}"]`;
    const el = this.box.querySelector<HTMLButtonElement>(`${row} [data-part="${f.part}"]`);
    // A button that has just been disabled (the first chapter's "Up") cannot take the focus.
    (el && !el.disabled ? el : this.box.querySelector<HTMLElement>(`${row} [data-part="pick"]`))?.focus();
  }

  private group(state: ListState, kind: SectionKind): HTMLElement {
    const ids = sectionIds(state.project, kind);
    const hid = `ch-h-${kind}`;
    const ul = h("ul", { cls: "ch-items", attr: { "aria-label": t("ch.listLabel", { section: sectionLabel(kind) }) } });
    ul.dataset.kind = kind;
    for (const id of ids) {
      const c = chapterById(state.project, id);
      if (c) ul.appendChild(this.row(state, kind, id, c.title));
    }
    // Dropping on the empty part of a group puts the chapter at its end.
    ul.addEventListener("dragover", (ev) => {
      if (!this.dragging) return;
      ev.preventDefault();
    });
    ul.addEventListener("drop", (ev) => {
      if (!this.dragging || ev.defaultPrevented) return;
      ev.preventDefault();
      this.deps.drop(this.dragging, kind, Number.MAX_SAFE_INTEGER);
      this.dragging = null;
    });
    return h(
      "section",
      { cls: "ch-group", attr: { "aria-labelledby": hid } },
      h("h3", { cls: "ch-group-title", text: sectionLabel(kind), attr: { id: hid } }),
      ids.length ? ul : h("p", { cls: "ch-empty", text: t("ch.empty") }),
      // An empty group still needs a place to drop onto.
      ids.length ? null : this.emptyDrop(kind),
      h("button", {
        cls: "ch-add",
        text: t("ch.add"),
        attr: { type: "button", "data-add": kind, "aria-label": t("ch.addLabel", { section: sectionLabel(kind) }) },
        on: { click: () => this.deps.add(kind) },
      }),
    );
  }

  private emptyDrop(kind: SectionKind): HTMLElement {
    const z = h("div", { cls: "ch-drop", attr: { "aria-hidden": "true" } });
    z.addEventListener("dragover", (ev) => {
      if (this.dragging) ev.preventDefault();
    });
    z.addEventListener("drop", (ev) => {
      if (!this.dragging) return;
      ev.preventDefault();
      this.deps.drop(this.dragging, kind, 0);
      this.dragging = null;
    });
    return z;
  }

  private row(state: ListState, kind: SectionKind, id: string, title: string): HTMLElement {
    const li = h("li", { cls: ["ch-item", state.active === id && "is-active"], attr: { "data-id": id } });
    if (state.renaming === id) {
      li.appendChild(this.renameForm(id, title));
      return li;
    }
    const total = state.project.chapters.length;
    const order = bookOrder(state.project);
    const first = order[0] === id;
    const last = order[order.length - 1] === id;
    const btn = (part: string, text: string, aria: string, fn: () => void, disabled = false) =>
      h("button", { cls: `ch-${part}`, text, attr: { type: "button", "data-part": part, "aria-label": aria, disabled }, on: { click: fn } });
    const pick = h("button", {
      cls: "ch-pick",
      text: title,
      attr: { type: "button", "data-part": "pick", "aria-current": state.active === id ? "true" : null, "aria-describedby": "ch-hint" },
      on: { click: () => this.deps.pick(id) },
    });
    // Alt+Up and Alt+Down on any button of the row move the chapter.
    li.addEventListener("keydown", (ev) => {
      if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
      ev.preventDefault();
      this.deps.move(id, ev.key === "ArrowUp" ? -1 : 1);
    });
    li.draggable = true;
    li.addEventListener("dragstart", (ev) => {
      this.dragging = id;
      ev.dataTransfer?.setData("text/plain", id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
      li.classList.add("is-dragging");
    });
    li.addEventListener("dragend", () => {
      this.dragging = null;
      li.classList.remove("is-dragging");
      this.box.querySelectorAll(".is-over").forEach((e) => e.classList.remove("is-over"));
    });
    li.addEventListener("dragover", (ev) => {
      if (!this.dragging || this.dragging === id) return;
      ev.preventDefault();
      li.classList.add("is-over");
    });
    li.addEventListener("dragleave", () => li.classList.remove("is-over"));
    li.addEventListener("drop", (ev) => {
      const from = this.dragging;
      li.classList.remove("is-over");
      if (!from || from === id) return;
      ev.preventDefault();
      const rect = li.getBoundingClientRect();
      const after = ev.clientY > rect.top + rect.height / 2;
      const others = sectionIds(state.project, kind).filter((c) => c !== from);
      this.deps.drop(from, kind, others.indexOf(id) + (after ? 1 : 0));
      this.dragging = null;
    });
    append(
      li,
      pick,
      h(
        "div",
        { cls: "ch-actions" },
        btn("up", t("ch.up"), t("ch.upLabel", { title }), () => this.deps.move(id, -1), first),
        btn("down", t("ch.down"), t("ch.downLabel", { title }), () => this.deps.move(id, 1), last),
        btn("rename", t("ch.rename"), t("ch.renameLabel", { title }), () => this.deps.startRename(id)),
        btn("delete", t("ch.delete"), t("ch.deleteLabel", { title }), () => void this.confirmDelete(id, title), total <= 1),
      ),
    );
    return li;
  }

  private renameForm(id: string, title: string): HTMLElement {
    const input = h("input", { attr: { type: "text", "aria-label": t("ch.newTitle"), value: title, autocomplete: "off" } });
    input.value = title;
    const form = h(
      "form",
      {
        cls: "ch-rename",
        on: {
          submit: (ev: Event) => {
            ev.preventDefault();
            this.deps.rename(id, input.value.trim() || title);
          },
          keydown: (ev: KeyboardEvent) => {
            if (ev.key === "Escape") this.deps.cancelRename(id);
          },
        },
      },
      input,
      h("button", { cls: "mod-cta", text: t("ch.save"), attr: { type: "submit" } }),
      h("button", { text: t("ch.cancel"), attr: { type: "button" }, on: { click: () => this.deps.cancelRename(id) } }),
    );
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return form;
  }

  private async confirmDelete(id: string, title: string): Promise<void> {
    const r = await this.deps.ask({ title: t("ch.deleteTitle"), message: t("ch.deleteMessage", { title }), ok: t("ch.deleteOk"), cancel: t("ch.cancel") });
    if (r === "ok") this.deps.remove(id);
  }
}
