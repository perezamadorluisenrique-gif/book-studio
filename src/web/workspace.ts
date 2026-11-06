// The writing screen for a book project: the chapter list, the chapter editor and the book preview
// (the Studio) side by side on a wide screen, or behind three tabs on a phone. It keeps the project in
// memory, saves it to the browser about half a second after you stop typing, and tells the app to rebuild the preview.

import { clear, h } from "../app/dom";
import type { Dialog } from "../app/host";
import { t } from "../app/ui-i18n";
import type { Plan } from "../engine/entitlements";
import type { SourceRef } from "../engine/model";
import { chapterById, type Project, type SectionKind } from "../project/model";
import { addChapter, bookOrder, locate, move, removeChapter, renameChapter, reorder, sectionIds, setChapterBody } from "../project/ops";
import { bodyStartLine, projectToVault } from "../project/to-vault";
import { ChapterList, sectionLabel, type ListFocus } from "./chapters";
import { DetailsForm } from "./details";
import { ChapterEditor } from "./editor";

export interface WorkspaceDeps {
  /** Write the project to the browser's storage. */
  save(p: Project): Promise<void>;
  /** The project changed: make the book from the new text. `saved` is true once it is stored. */
  changed(p: Project, saved: boolean): void;
  ask(d: Dialog): Promise<"ok" | "cancel" | "extra">;
  notify(message: string): void;
  plan(): Plan;
  /** The book form changed the theme or trim: forget a choice made in the preview bar, so the form wins. */
  layoutChanged(p: Project, keys: string[]): void;
  /** The "Publish checklist" button was pressed. */
  publish(): void;
  /** The "Versions" and "Find and replace" buttons were pressed. */
  versions(): void;
  search(): void;
  /** Download a copy of the book as a .zip. */
  backup(p: Project): Promise<void>;
}

type Tab = "chapters" | "write" | "book";
const TABS: Tab[] = ["chapters", "write", "book"];
/** How long after the last key the text is saved (the plan says at most one second). */
const SAVE_DELAY = 500;
const NARROW = "(max-width: 900px)";

export class Workspace {
  /** Where the Studio (preview and export) is placed. */
  readonly bookSlot = h("div", { cls: "ws-slot" });
  private project: Project | null = null;
  private active: string | null = null;
  private renaming: string | null = null;
  private tab: Tab = "write";
  private dirty = false;
  private timer = 0;
  private chain: Promise<void> = Promise.resolve();
  private tabsEl = h("div", { cls: "ws-tabs", attr: { role: "tablist" } });
  private tabButtons = {} as Record<Tab, HTMLButtonElement>;
  private panels = {} as Record<Tab, HTMLElement>;
  private listBox = h("div", { cls: "ws-list" });
  private detailsButton = h("button", { cls: "ws-details-btn", attr: { type: "button", id: "ws-details-btn" }, on: { click: () => this.openDetails() } });
  private publishButton = h("button", { cls: "ws-details-btn ws-publish-btn", attr: { type: "button", id: "ws-publish-btn" }, on: { click: () => this.deps.publish() } });
  private versionsButton = h("button", { cls: "ws-details-btn", attr: { type: "button", id: "ws-versions-btn" }, on: { click: () => this.deps.versions() } });
  private searchButton = h("button", { cls: "ws-details-btn", attr: { type: "button", id: "ws-search-btn" }, on: { click: () => this.deps.search() } });
  private backupButton = h("button", { cls: "ws-details-btn", attr: { type: "button", id: "ws-backup-btn" }, on: { click: () => void this.backup() } });
  private listInner = h("div");
  private editorBox = h("div", { cls: "ws-editor" });
  private detailsBox = h("div", { cls: "ws-details" });
  private view: "chapter" | "details" = "chapter";
  private list!: ChapterList;
  private editor!: ChapterEditor;
  private details!: DetailsForm;
  private media = window.matchMedia(NARROW);

  constructor(
    private root: HTMLElement,
    private deps: WorkspaceDeps,
  ) {
    for (const id of TABS) {
      this.tabButtons[id] = h("button", {
        cls: "ws-tab",
        attr: { type: "button", role: "tab", id: `ws-tab-${id}`, "aria-controls": `ws-panel-${id}` },
        on: { click: () => this.setTab(id), keydown: (ev) => this.tabKey(ev, id) },
      });
      this.panels[id] = h("section", { cls: `ws-col ws-col-${id}`, attr: { id: `ws-panel-${id}` } });
    }
    this.panels.chapters.appendChild(this.listBox);
    this.listBox.append(this.detailsButton, this.publishButton, this.searchButton, this.versionsButton, this.backupButton, this.listInner);
    this.panels.write.append(this.editorBox, this.detailsBox);
    this.panels.book.appendChild(this.bookSlot);
    this.tabsEl.append(...TABS.map((id) => this.tabButtons[id]));
    root.append(this.tabsEl, ...TABS.map((id) => this.panels[id]));
    this.media.addEventListener("change", () => this.applyMode());
    this.build();
  }

  // ── Screen ──

  /** (Re)make the list and the editor and put every text in the current language. */
  private build(): void {
    clear(this.listInner);
    clear(this.editorBox);
    clear(this.detailsBox);
    this.details?.release();
    this.list = new ChapterList(this.listInner, {
      pick: (id) => this.pick(id),
      add: (kind) => this.add(kind),
      startRename: (id) => {
        this.renaming = id;
        this.renderList({ id, part: "rename" });
      },
      rename: (id, title) => this.rename(id, title),
      cancelRename: (id) => {
        this.renaming = null;
        this.renderList({ id, part: "pick" });
      },
      remove: (id) => this.remove(id),
      move: (id, delta) => this.moveChapter(id, delta),
      drop: (id, kind, index) => this.drop(id, kind, index),
      ask: (d) => this.deps.ask(d),
    });
    this.editor = new ChapterEditor(this.editorBox, { input: (body) => this.typed(body) });
    this.details = new DetailsForm(this.detailsBox, {
      plan: () => this.deps.plan(),
      current: () => this.project,
      change: (next, layout) => {
        this.project = next;
        if (layout) this.deps.layoutChanged(next, layout);
        this.markDirty(false);
      },
      notify: (m) => this.deps.notify(m),
    });
    this.versionsButton.textContent = t("ver.open");
    this.versionsButton.setAttribute("aria-label", t("ver.openLabel"));
    this.searchButton.textContent = t("find.open");
    this.searchButton.setAttribute("aria-label", t("find.openLabel"));
    this.publishButton.textContent = t("pub.open");
    this.publishButton.setAttribute("aria-label", t("pub.openLabel"));
    this.backupButton.textContent = t("proj.backup");
    this.detailsButton.textContent = t("dt.open");
    this.detailsButton.setAttribute("aria-label", t("dt.openLabel"));
    this.tabsEl.setAttribute("aria-label", t("ws.tabs"));
    for (const id of TABS) this.tabButtons[id].textContent = t(id === "chapters" ? "ws.tabChapters" : id === "write" ? "ws.tabWrite" : "ws.tabBook");
    this.panels.chapters.setAttribute("aria-label", t("ws.panelChapters"));
    this.panels.write.setAttribute("aria-label", t("ws.panelWrite"));
    this.panels.book.setAttribute("aria-label", t("ws.panelBook"));
    this.applyMode();
    this.applyTab();
    if (this.project) {
      this.renderList();
      this.showActive();
      if (this.view === "details") this.details.show();
    }
    this.applyView();
  }

  /** Save the latest words, then download a copy of the book. */
  private async backup(): Promise<void> {
    if (!this.project) return;
    await this.flush();
    try {
      await this.deps.backup(this.project);
    } catch (e) {
      this.deps.notify(t("proj.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  /** Draw the screen again after the language changed. */
  rerender(): void {
    if (this.project) void this.flush();
    this.build();
  }

  /** On a phone the three columns are tabs; on a wide screen they are plain regions side by side. */
  private applyMode(): void {
    const narrow = this.media.matches;
    for (const id of TABS) {
      const p = this.panels[id];
      if (narrow) {
        p.setAttribute("role", "tabpanel");
        p.setAttribute("aria-labelledby", `ws-tab-${id}`);
        p.removeAttribute("aria-label");
      } else {
        p.removeAttribute("role");
        p.removeAttribute("aria-labelledby");
        p.setAttribute("aria-label", t(id === "chapters" ? "ws.panelChapters" : id === "write" ? "ws.panelWrite" : "ws.panelBook"));
      }
    }
  }

  /** Show the chapter editor or the book details form in the middle column. */
  private applyView(): void {
    const details = this.view === "details";
    this.editorBox.hidden = details;
    this.detailsBox.hidden = !details;
    this.detailsButton.setAttribute("aria-pressed", String(details));
  }

  private openDetails(): void {
    if (!this.project) return;
    this.view = "details";
    this.details.show();
    this.applyView();
    if (this.media.matches) this.setTab("write");
    this.details.focus();
  }

  /** Take the person to one of the three places: the book form, the chapter list or the book column (Problems). */
  reveal(place: "details" | "chapters" | "book"): void {
    if (!this.project) return;
    if (place === "details") this.openDetails();
    else if (place === "chapters") {
      this.showChapters();
      this.setTab("chapters");
      this.listBox.querySelector<HTMLElement>(".ch-pick")?.focus();
    } else this.setTab("book");
  }

  private showChapters(): void {
    if (this.view === "chapter") return;
    this.view = "chapter";
    this.details.release();
    this.applyView();
  }

  private setTab(tab: Tab, focus = false): void {
    this.tab = tab;
    this.applyTab();
    if (focus) this.tabButtons[tab].focus();
  }

  private applyTab(): void {
    this.root.dataset.tab = this.tab;
    for (const id of TABS) {
      this.tabButtons[id].setAttribute("aria-selected", String(id === this.tab));
      this.tabButtons[id].tabIndex = id === this.tab ? 0 : -1;
    }
  }

  private tabKey(ev: KeyboardEvent, id: Tab): void {
    const i = TABS.indexOf(id);
    const next = ev.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : ev.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : ev.key === "Home" ? TABS[0] : ev.key === "End" ? TABS[TABS.length - 1] : null;
    if (!next) return;
    ev.preventDefault();
    this.setTab(next, true);
  }

  private renderList(focus?: ListFocus): void {
    if (this.project) this.list.render({ project: this.project, active: this.active, renaming: this.renaming }, focus);
  }

  private showActive(line?: number): void {
    const c = this.project && this.active ? chapterById(this.project, this.active) : undefined;
    if (c && this.project) this.editor.show(c.title, c.body, this.project.meta.language || "en", line);
    else this.editor.clear();
  }

  // ── Opening and closing ──

  open(project: Project): void {
    this.project = project;
    this.active = bookOrder(project)[0] ?? null;
    this.renaming = null;
    this.dirty = false;
    this.tab = "write";
    this.view = "chapter";
    this.applyView();
    this.root.hidden = false;
    this.applyTab();
    this.renderList();
    this.showActive();
  }

  /** Show a chapter in the editor (from the search window). */
  openChapter(id: string): void {
    this.pick(id);
    this.setTab("write");
    this.editor.focus();
  }

  /** Put another version of the open book in place (a restore or a replace), show it and save it. */
  replaceProject(next: Project): void {
    if (!this.project || next.id !== this.project.id) return;
    this.project = next;
    if (!this.active || !chapterById(next, this.active)) this.active = bookOrder(next)[0] ?? null;
    this.renaming = null;
    this.renderList();
    this.showActive();
    if (this.view === "details") this.details.show();
    this.markDirty(true);
  }

  /** Save what is waiting and hide the screen. */
  async close(): Promise<void> {
    await this.flush();
    this.root.hidden = true;
    this.project = null;
    this.active = null;
  }

  get isOpen(): boolean {
    return this.project !== null;
  }

  /** Open the chapter that owns a note path at a line of that note (used by the Problems tab). */
  openSource(src: SourceRef): void {
    if (!this.project) return;
    const vault = projectToVault(this.project);
    if (src.file === vault.bookPath) {
      this.openDetails();
      return;
    }
    const found = Object.entries(vault.chapterPaths).find(([, path]) => path === src.file);
    const c = found && chapterById(this.project, found[0]);
    if (!c) {
      this.deps.notify(t("ws.notEditable"));
      return;
    }
    this.showChapters();
    this.active = c.id;
    this.renaming = null;
    this.renderList();
    this.showActive(Math.max(1, src.line - bodyStartLine(c) + 1));
    this.setTab("write");
    this.editor.focus();
  }

  // ── Saving ──

  private typed(body: string): void {
    if (!this.project || !this.active) return;
    this.project = setChapterBody(this.project, this.active, body, Date.now());
    this.markDirty(false);
  }

  private markDirty(now: boolean): void {
    if (!this.project) return;
    this.dirty = true;
    this.editor.setStatus("saving");
    this.deps.changed(this.project, false);
    window.clearTimeout(this.timer);
    if (now) void this.flush();
    else this.timer = window.setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  /** Write the project now if there is anything waiting. Resolves when the write is done. */
  flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.dirty && this.project) {
      this.dirty = false;
      const snapshot = this.project;
      this.chain = this.chain.then(async () => {
        try {
          await this.deps.save(snapshot);
          if (this.project?.id !== snapshot.id) return;
          if (!this.dirty) this.editor.setStatus("saved");
          this.deps.changed(this.project, true);
        } catch (e) {
          this.dirty = true;
          const error = e instanceof Error ? e.message : String(e);
          this.editor.setStatus("error", error);
          if (this.view === "details") this.deps.notify(t("ed.saveFailed", { error }));
        }
      });
    }
    return this.chain;
  }

  // ── Changing the chapters ──

  private commit(next: Project, focus?: ListFocus): void {
    this.project = next;
    this.renderList(focus);
    this.markDirty(true);
  }

  private pick(id: string): void {
    if (!this.project || !chapterById(this.project, id)) return;
    this.showChapters();
    this.active = id;
    this.renaming = null;
    this.renderList({ id, part: "pick" });
    this.showActive();
    if (this.media.matches) {
      this.setTab("write");
      this.editor.focus();
    }
  }

  private add(kind: SectionKind): void {
    if (!this.project) return;
    this.showChapters();
    const next = addChapter(this.project, kind, t("ch.defaultTitle"), Date.now());
    const id = next.chapters[next.chapters.length - 1].id;
    this.active = id;
    this.renaming = id;
    this.commit(next);
    this.showActive();
    this.list.announce(t("ch.added", { title: t("ch.defaultTitle") }));
  }

  private rename(id: string, title: string): void {
    if (!this.project) return;
    this.renaming = null;
    this.commit(renameChapter(this.project, id, title, Date.now()), { id, part: "pick" });
    if (id === this.active) this.showActive();
    this.list.announce(t("ch.renamed", { title }));
  }

  private remove(id: string): void {
    if (!this.project) return;
    const c = chapterById(this.project, id);
    const order = bookOrder(this.project);
    if (!c || order.length <= 1) return;
    const i = order.indexOf(id);
    const next = removeChapter(this.project, id, Date.now());
    if (this.active === id) this.active = order[i + 1] ?? order[i - 1] ?? null;
    this.renaming = null;
    this.commit(next, this.active ? { id: this.active, part: "pick" } : undefined);
    this.showActive();
    this.list.announce(t("ch.deleted", { title: c.title }));
  }

  private moveChapter(id: string, delta: -1 | 1): void {
    if (!this.project) return;
    this.placed(id, move(this.project, id, delta, Date.now()));
  }

  private drop(id: string, kind: SectionKind, index: number): void {
    if (!this.project) return;
    this.placed(id, reorder(this.project, id, kind, index, Date.now()));
  }

  /** Use the project with a chapter in a new place, and say where it went. */
  private placed(id: string, next: Project): void {
    const c = this.project && chapterById(this.project, id);
    if (!this.project || !c) return;
    if (next === this.project) {
      this.list.announce(t("ch.atEdge", { title: c.title }));
      return;
    }
    this.commit(next, { id, part: "pick" });
    const at = locate(next, id);
    if (at) this.list.announce(t("ch.moved", { title: c.title, section: sectionLabel(at.kind), n: at.index + 1, total: sectionIds(next, at.kind).length }));
  }
}
