// The Obsidian plugin: a Book Studio view over the vault, commands for the
// common exports, and a settings tab for the export folder and the Pro key.

import { App, getLinkpath, ItemView, Modal, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, type SettingDefinitionItem, type WorkspaceLeaf } from "obsidian";
import { ACTIVATE_URL, CHECKOUT_URL, FREE_EDITION, PRO_PREVIEW } from "../config";
import { append, h, setElementFactory } from "../app/dom";
import type { BookChoice, Dialog, OutputFile, Store, StudioHost } from "../app/host";
import { LicenseError, LicenseManager } from "../app/license-manager";
import { pickLicenseFile } from "../app/license-panel";
import { Studio } from "../app/studio";
import type { VaultSource } from "../engine/book";
import { PRO_FEATURES } from "../engine/entitlements";
import { fmString, isManifestFrontmatter, manifestTemplate } from "../engine/manifest";
import type { SourceRef } from "../engine/model";
import { loadBundledFont } from "./fonts";

const VIEW_TYPE = "book-studio";

interface Settings {
  exportFolder: string;
  author: string;
  /** The studio's own storage: license, free book, per-book choices, view options. */
  data: Record<string, unknown>;
}

const DEFAULT_SETTINGS: Settings = { exportFolder: "Book Studio exports", author: "", data: {} };

export default class BookStudioPlugin extends Plugin {
  override settings: Settings = DEFAULT_SETTINGS;
  store!: Store;
  license!: LicenseManager;
  private saveTimer = 0;

  override async onload(): Promise<void> {
    setElementFactory((tag) => createEl(tag));
    await this.loadSettings();
    this.store = {
      get: <T>(k: string) => this.settings.data[k] as T | undefined,
      set: (k, v) => {
        if (v === undefined) delete this.settings.data[k];
        else this.settings.data[k] = v;
        this.requestSave();
      },
    };
    this.license = new LicenseManager({ store: this.store });

    this.registerView(VIEW_TYPE, (leaf) => new StudioView(leaf, this));
    this.addRibbonIcon("book-open", "Open Book Studio", () => void this.openStudio());

    this.addCommand({ id: "open", name: "Open studio", icon: "book-open", callback: () => void this.openStudio() });
    this.addCommand({ id: "export-pdf", name: "Export print PDF", icon: "printer", callback: () => void this.withStudio((s) => s.exportPdf()) });
    this.addCommand({ id: "export-epub", name: "Export EPUB", icon: "tablet-smartphone", callback: () => void this.withStudio((s) => s.exportEpub()) });
    if (!FREE_EDITION) this.addCommand({ id: "export-accessibility-report", name: "Export accessibility report", icon: "accessibility", callback: () => void this.withStudio((s) => s.exportReport()) });
    this.addCommand({
      id: "create-book",
      name: "Create book from current folder",
      icon: "book-plus",
      checkCallback: (checking) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (!folder) return false;
        if (!checking) void this.createBook(folder);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) menu.addItem((item) => item.setTitle("Create book from this folder").setIcon("book-plus").onClick(() => void this.createBook(file)));
      }),
    );

    // Live preview: rebuild when a note or image the book uses changes.
    this.registerEvent(this.app.vault.on("modify", (f) => this.fileChanged(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => this.fileChanged(f.path)));
    this.registerEvent(this.app.vault.on("rename", (_f, old) => this.fileChanged(old)));
    // A note gaining or losing book: true changes the list of books.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        const manifest = isManifestFrontmatter(cache.frontmatter);
        for (const s of this.studios()) if (manifest || s.listsBook(file.path)) s.scheduleBuild(800, true);
      }),
    );

    this.addSettingTab(new BookStudioSettingTab(this.app, this));
  }

  override onunload(): void {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      void this.saveData(this.settings);
    }
  }

  async loadSettings(): Promise<void> {
    const saved = ((await this.loadData()) ?? {}) as Partial<Settings>;
    this.settings = { ...DEFAULT_SETTINGS, ...saved, data: { ...(saved.data ?? {}) } };
  }

  override async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
  }

  requestSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      void this.saveData(this.settings);
    }, 400);
  }

  private studios(): Studio[] {
    const out: Studio[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof StudioView && view.studio) out.push(view.studio);
    }
    return out;
  }

  private fileChanged(path: string): void {
    for (const s of this.studios()) if (s.usesFile(path)) s.scheduleBuild(path === s.bookPath ? 600 : 1000, path === s.bookPath);
  }

  async openStudio(): Promise<Studio | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (!(view instanceof StudioView)) return null;
    await view.ready;
    return view.studio;
  }

  private async withStudio(fn: (s: Studio) => Promise<void>): Promise<void> {
    const studio = await this.openStudio();
    if (studio) await fn(studio);
  }

  // ── Vault access ──

  vaultSource(): VaultSource {
    const { vault, metadataCache } = this.app;
    const file = (path: string) => {
      const f = vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) throw new Error(`File not found: ${path}`);
      return f;
    };
    return {
      read: (p) => vault.cachedRead(file(p)),
      readBinary: async (p) => new Uint8Array(await vault.readBinary(file(p))),
      resolve: (target, from) => metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path ?? null,
    };
  }

  listBooks(): BookChoice[] {
    const books: BookChoice[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (isManifestFrontmatter(fm)) books.push({ path: f.path, title: fmString(fm ?? {}, "title") ?? f.basename });
    }
    return books.sort((a, b) => a.title.localeCompare(b.title));
  }

  async saveOutput(out: OutputFile): Promise<string> {
    const { vault } = this.app;
    const folder = normalizePath(this.settings.exportFolder || DEFAULT_SETTINGS.exportFolder);
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
    const path = normalizePath(`${folder}/${out.name}`);
    const existing = vault.getAbstractFileByPath(path);
    if (typeof out.data === "string") {
      if (existing instanceof TFile) await vault.modify(existing, out.data);
      else await vault.create(path, out.data);
    } else {
      const buf = out.data.buffer.slice(out.data.byteOffset, out.data.byteOffset + out.data.byteLength) as ArrayBuffer;
      if (existing instanceof TFile) await vault.modifyBinary(existing, buf);
      else await vault.createBinary(path, buf);
    }
    return `Saved ${path}`;
  }

  async openSource(src: SourceRef): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(src.file);
    if (!(f instanceof TFile)) return;
    await this.app.workspace.getLeaf(false).openFile(f, { eState: { line: Math.max(0, src.line - 1) } });
  }

  openLicenseSettings(): void {
    // The settings API for opening a specific tab isn't public; fall back to a modal.
    new LicenseModal(this.app, this).open();
  }

  async createBook(folder: TFolder): Promise<void> {
    const notes = folder.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
      .filter((f) => !isManifestFrontmatter(this.app.metadataCache.getFileCache(f)?.frontmatter))
      .sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
    if (!notes.length) {
      new Notice("This folder has no notes to put in a book.");
      return;
    }
    const title = folder.isRoot() ? this.app.vault.getName() : folder.name;
    const dir = folder.isRoot() ? "" : `${folder.path}/`;
    let path = normalizePath(`${dir}${title}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${dir}${title} (book ${n}).md`);
    const file = await this.app.vault.create(path, manifestTemplate(title, this.settings.author, notes.map((n) => n.basename)));
    await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(`Created ${file.path}. Reorder the links to reorder the chapters.`);
    const studio = await this.openStudio();
    studio?.scheduleBuild(300, true);
  }

  hostFor(): StudioHost {
    return {
      kind: "obsidian",
      source: () => this.vaultSource(),
      listBooks: async () => this.listBooks(),
      loadFont: loadBundledFont,
      save: (out) => this.saveOutput(out),
      store: this.store,
      ask: (d) => new AskModal(this.app, d).wait(),
      notify: (m) => void new Notice(m),
      openUrl: (url) => void window.open(url),
      openSource: (src) => void this.openSource(src),
      openLicense: () => this.openLicenseSettings(),
      renderEmpty: (box) => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        append(
          box,
          h("h2", { text: "No book in this vault yet" }),
          h("p", { text: "Turn a folder of chapter notes into a book: right-click the folder and choose Create book from this folder, or use the button below for the folder of the note you have open." }),
        );
        if (folder) append(box, h("button", { cls: "mod-cta", text: `Create a book from “${folder.isRoot() ? this.app.vault.getName() : folder.name}”`, on: { click: () => void this.createBook(folder) } }));
      },
    };
  }
}

class StudioView extends ItemView {
  studio: Studio | null = null;
  ready: Promise<void> = Promise.resolve();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: BookStudioPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Book Studio";
  }

  override getIcon(): string {
    return "book-open";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("bs-view");
    this.studio = new Studio(this.plugin.hostFor(), this.contentEl, this.plugin.license);
    this.ready = this.studio.refresh();
    await this.ready;
  }

  override async onClose(): Promise<void> {
    this.studio?.dispose();
    this.studio = null;
  }
}

class AskModal extends Modal {
  private result: "ok" | "cancel" | "extra" = "cancel";
  private done: (r: "ok" | "cancel" | "extra") => void = () => {};

  constructor(
    app: App,
    private dialog: Dialog,
  ) {
    super(app);
  }

  wait(): Promise<"ok" | "cancel" | "extra"> {
    return new Promise((resolve) => {
      this.done = resolve;
      this.open();
    });
  }

  override onOpen(): void {
    const d = this.dialog;
    this.titleEl.setText(d.title);
    for (const p of d.message.split("\n\n")) this.contentEl.createEl("p", { text: p, cls: "bs-dialog-text" });
    const row = new Setting(this.contentEl);
    row.addButton((b) => b.setButtonText(d.cancel ?? "Cancel").onClick(() => this.finish("cancel")));
    if (d.extra) row.addButton((b) => b.setButtonText(d.extra!).onClick(() => this.finish("extra")));
    row.addButton((b) => b.setButtonText(d.ok).setCta().onClick(() => this.finish("ok")));
  }

  private finish(r: "ok" | "cancel" | "extra"): void {
    this.result = r;
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.done(this.result);
  }
}

/** License controls, shared by the settings tab and the modal the studio opens. */
function licenseSettings(containerEl: HTMLElement, plugin: BookStudioPlugin, redraw: () => void): void {
  const license = plugin.license;
  new Setting(containerEl).setName("Book Studio Pro").setHeading();
  new Setting(containerEl).setName("Status").setDesc(license.previewPro ? "Pro preview is on. Exports include every Pro feature in this developer build." : license.describe());

  if (license.key) {
    new Setting(containerEl)
      .setName("Remove license key")
      .setDesc("Book Studio goes back to the free plan on this device. You can paste the key again any time.")
      .addButton((b) =>
        b.setButtonText("Remove").onClick(() => {
          license.remove();
          redraw();
        }),
      );
  } else {
    let key = "";
    const error = createDiv({ cls: "bs-setting-error" });
    const activate = (text: string) => {
      error.setText("");
      try {
        license.activate(text);
        new Notice("Book Studio Pro is active.");
        redraw();
      } catch (e) {
        error.setText(e instanceof LicenseError ? e.message : "Activation failed.");
      }
    };
    const setting = new Setting(containerEl)
      .setName("License key")
      .setDesc("Paste your key, or import the .bslicense file. It is checked on this device, without the internet.")
      .addText((t) => t.setPlaceholder("Paste your key").onChange((v) => (key = v)))
      .addButton((b) => b.setButtonText("Activate").setCta().onClick(() => activate(key)))
      .addButton((b) => b.setButtonText("Import file…").onClick(() => pickLicenseFile(activate)));
    setting.descEl.appendChild(error);
  }

  const buy = new Setting(containerEl).setName("Get Book Studio Pro").setDesc(CHECKOUT_URL ? Object.values(PRO_FEATURES).join(" · ") : `Book Studio Pro isn't on sale yet. It will add: ${Object.values(PRO_FEATURES).join(" · ")}`);
  if (CHECKOUT_URL) buy.addButton((b) => b.setButtonText("Buy").onClick(() => window.open(CHECKOUT_URL)));
  if (CHECKOUT_URL && ACTIVATE_URL) buy.addButton((b) => b.setButtonText("I have bought it: get my key").onClick(() => window.open(ACTIVATE_URL)));

  if (PRO_PREVIEW) {
    new Setting(containerEl)
      .setName("Preview every feature without a key")
      .setDesc("Developer builds only.")
      .addToggle((t) =>
        t.setValue(license.previewPro).onChange((v) => {
          license.previewPro = v;
          redraw();
        }),
      );
  }

  containerEl.createEl("p", { cls: "setting-item-description", text: "A key never expires. Book Studio makes no network requests: your notes and books never leave your device." });
}

class LicenseModal extends Modal {
  constructor(
    app: App,
    private plugin: BookStudioPlugin,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.draw();
  }

  private draw(): void {
    this.contentEl.empty();
    licenseSettings(this.contentEl, this.plugin, () => this.draw());
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

const TEXT = {
  exportFolder: { name: "Export folder", desc: "Exported books and reports are saved in this vault folder." },
  author: { name: "Author", desc: "Filled in when you create a book from a folder." },
};

class BookStudioSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: BookStudioPlugin,
  ) {
    super(app, plugin);
  }

  /**
   * Obsidian 1.13 and later render these itself and index them for the settings
   * search; older versions call `display()`. The Pro build's license controls
   * aren't declarative, so it keeps `display()` everywhere.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    if (!FREE_EDITION) return [];
    return [
      { name: TEXT.exportFolder.name, desc: TEXT.exportFolder.desc, control: { type: "text", key: "exportFolder", placeholder: DEFAULT_SETTINGS.exportFolder, defaultValue: DEFAULT_SETTINGS.exportFolder } },
      { name: TEXT.author.name, desc: TEXT.author.desc, control: { type: "text", key: "author", defaultValue: "" } },
    ];
  }

  override getControlValue(key: string): unknown {
    return key === "exportFolder" ? this.plugin.settings.exportFolder : key === "author" ? this.plugin.settings.author : undefined;
  }

  override setControlValue(key: string, value: unknown): void {
    const v = typeof value === "string" ? value.trim() : "";
    if (key === "exportFolder") this.plugin.settings.exportFolder = v || DEFAULT_SETTINGS.exportFolder;
    else if (key === "author") this.plugin.settings.author = v;
    else return;
    this.plugin.requestSave();
  }

  /** The pre-1.13 rendering, and the Pro build's on every version. */
  override display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(TEXT.exportFolder.name)
      .setDesc(TEXT.exportFolder.desc)
      .addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.exportFolder).setValue(this.plugin.settings.exportFolder).onChange((v) => this.setControlValue("exportFolder", v)));
    new Setting(containerEl)
      .setName(TEXT.author.name)
      .setDesc(TEXT.author.desc)
      .addText((t) => t.setValue(this.plugin.settings.author).onChange((v) => this.setControlValue("author", v)));
    if (!FREE_EDITION) licenseSettings(containerEl, this.plugin, () => this.render());
  }
}
