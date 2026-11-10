// The web app: the same studio as the Obsidian plugin, reading a folder of
// Markdown notes from the computer (or the bundled sample book). Notes are read
// in the browser and outputs are downloaded; nothing is uploaded anywhere.

import { append, clear, h, setElementFactory } from "../app/dom";
import type { BookChoice, Dialog, OutputFile, Store, StudioHost } from "../app/host";
import { renderLicensePanel } from "../app/license-panel";
import { LicenseManager } from "../app/license-manager";
import { backupDue } from "../project/backup";
import { vaultToProjects, type ImportFiles, type ImportResult } from "../project/from-vault";
import { createProject, renameProject } from "../project/ops";
import { exportZip, importZip, zipName } from "../project/zip";
import { projectFromText } from "../project/import-text";
import { remoteLayout } from "./layout-remote";
import { registerPwa } from "./pwa";
import { showSearch } from "./search";
import { themeThumbnail } from "./theme-thumbs";
import { Wizard } from "./wizard";
import { showVersions } from "./versions";
import { makeSnapshot, restoreSnapshot, sameContent, contentOf, type SnapshotKind } from "../project/snapshots";
import { replaceAll } from "../project/search";
import { Workspace } from "./workspace";
import { projectToVault, type ProjectVault } from "../project/to-vault";
import type { Project } from "../project/model";
import { fetchPost } from "./post";
import { renderProjects } from "./projects";
import { openCoverEditor } from "./cover-editor";
import { showPublishChecklist } from "./publish";
import { deleteProject, deleteSnapshot, getHandle, listProjects, listSnapshots, putProject, putSnapshot, setHandle } from "./store";
import { Studio } from "../app/studio";
import { detectLocale, setLocale, t, type Locale } from "../app/ui-i18n";
import type { VaultSource } from "../engine/book";
import type { SourceRef } from "../engine/model";
import type { FontFile } from "../engine/fonts";
import { fmString, isManifestFrontmatter } from "../engine/manifest";
import { splitFrontmatter } from "../engine/markdown";
import { createResolver } from "../engine/resolve";

// The web app has a single window, so it uses the page's document (Obsidian's activeDocument doesn't exist here).
const doc: Document = window.document;

// ── Folders ──

interface Folder {
  name: string;
  paths: string[];
  file(path: string): Promise<Blob>;
  sample?: boolean;
}

const WANTED = /\.(md|markdown|png|jpe?g|gif|webp|svg)$/i;
const SKIP_DIR = /^(\.|node_modules$)/;

// The File System Access API isn't in TypeScript's DOM types yet.
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
interface DirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FileHandle | DirHandle]>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
}
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: "read" }) => Promise<DirHandle> };

async function folderFromHandle(dir: DirHandle): Promise<Folder> {
  const files = new Map<string, FileHandle>();
  const walk = async (d: DirHandle, prefix: string, depth: number) => {
    if (depth > 12) return;
    for await (const [name, handle] of d.entries()) {
      if (handle.kind === "directory") {
        if (!SKIP_DIR.test(name)) await walk(handle, `${prefix}${name}/`, depth + 1);
      } else if (WANTED.test(name)) files.set(prefix + name, handle);
    }
  };
  await walk(dir, "", 0);
  // Each read gets the file as it is now, so Rebuild picks up edits.
  return { name: dir.name, paths: [...files.keys()], file: (p) => need(files.get(p), p).getFile() };
}

function folderFromFiles(list: FileList): Folder {
  const files = new Map<string, File>();
  let name = "Folder";
  for (const f of Array.from(list)) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split("/");
    if (parts.length > 1) name = parts[0];
    const path = parts.length > 1 ? parts.slice(1).join("/") : rel;
    if (parts.slice(1, -1).some((p) => SKIP_DIR.test(p)) || !WANTED.test(path)) continue;
    files.set(path, f);
  }
  return { name, paths: [...files.keys()], file: async (p) => need(files.get(p), p) };
}

// The bundled sample books; `?sample=leyendas` opens the Spanish one (the guides link to it).
const SAMPLES = ["oz", "leyendas"];

function sampleName(): string {
  const asked = new URLSearchParams(location.search).get("sample") ?? "";
  return SAMPLES.includes(asked) ? asked : SAMPLES[0];
}

async function sampleFolder(): Promise<Folder> {
  const base = new URL(`sample/${sampleName()}/`, doc.baseURI);
  const res = await fetch(new URL("files.json", base));
  if (!res.ok) throw new Error(t("web.sampleFailed"));
  const paths = (await res.json()) as string[];
  return {
    name: "Sample",
    sample: true,
    paths,
    file: async (p) => {
      const r = await fetch(new URL(p.split("/").map(encodeURIComponent).join("/"), base));
      if (!r.ok) throw new Error(t("web.missingSample", { path: p }));
      return r.blob();
    },
  };
}

function need<T>(v: T | undefined, path: string): T {
  if (v === undefined) throw new Error(t("web.notFound", { path }));
  return v;
}

function vaultFor(folder: Folder): VaultSource {
  return {
    read: async (p) => (await folder.file(p)).text(),
    readBinary: async (p) => new Uint8Array(await (await folder.file(p)).arrayBuffer()),
    resolve: createResolver(folder.paths),
  };
}

async function findBooks(folder: Folder): Promise<BookChoice[]> {
  const books: BookChoice[] = [];
  for (const path of folder.paths) {
    if (!/\.(md|markdown)$/i.test(path)) continue;
    // Frontmatter sits at the top; a manifest's is rarely longer than this.
    const head = await (await folder.file(path)).slice(0, 65536).text();
    if (!head.startsWith("---")) continue;
    const { frontmatter } = splitFrontmatter(head);
    if (isManifestFrontmatter(frontmatter)) books.push({ path, title: fmString(frontmatter, "title") ?? path.replace(/^.*\//, "").replace(/\.md$/i, "") });
  }
  return books.sort((a, b) => a.title.localeCompare(b.title));
}

// ── Settings ──

function localStore(): Store {
  const KEY = "book-studio";
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    get: <T>(k: string) => data[k] as T | undefined,
    set: (k, v) => {
      if (v === undefined) delete data[k];
      else data[k] = v;
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        // Storage full or blocked: settings last for this visit only.
      }
    },
  };
}

// ── UI pieces ──

// Namespaced creation gives the same HTML elements; Obsidian's createEl helper isn't on the web.
setElementFactory((tag) => doc.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLElementTagNameMap[typeof tag]);

const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
const dialog = $<HTMLDialogElement>("dialog");

function showDialog(title: string, body: Node[], buttons: { label: string; value: string; primary?: boolean }[]): Promise<string> {
  if (dialog.open) dialog.close("cancel");
  $("dialog-title").textContent = title;
  const bodyEl = $("dialog-body");
  clear(bodyEl);
  append(bodyEl, ...body);
  const btns = $("dialog-buttons");
  clear(btns);
  for (const b of buttons) append(btns, h("button", { cls: b.primary ? "mod-cta" : undefined, text: b.label, attr: { value: b.value, type: "submit" } }));
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue || "cancel"), { once: true }));
}

function toast(message: string): void {
  const el = h("div", { cls: "app-toast", text: message });
  $("toasts").appendChild(el);
  window.setTimeout(() => el.remove(), 6000);
}

function download(file: OutputFile): void {
  const blob = new Blob([file.data as BlobPart], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = h("a", { attr: { href: url, download: file.name } });
  doc.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── App ──

let folder: Folder | null = null;
// The book project that is open, if any (then `folder` is null): its notes are generated in memory.
let current: { project: Project; vault: ProjectVault } | null = null;
const store = localStore();

// The language: the saved choice, otherwise the browser's.
let locale: Locale = ((): Locale => {
  const saved = store.get<string>("lang");
  return saved === "en" || saved === "es" ? saved : detectLocale(navigator.language);
})();
setLocale(locale);

const host: StudioHost = {
  kind: "web",
  source: () => (current ? current.vault : folder ? vaultFor(folder) : null),
  listBooks: () => (current ? Promise.resolve([{ path: current.vault.bookPath, title: current.vault.bookTitle }]) : folder ? findBooks(folder) : Promise.resolve([])),
  layout: remoteLayout(new URL("layout-worker.js", doc.baseURI)),
  loadFont: async (f: FontFile) => {
    const res = await fetch(new URL(`fonts/${f}.ttf`, doc.baseURI));
    if (!res.ok) throw new Error(t("web.fontFailed", { font: f }));
    return new Uint8Array(await res.arrayBuffer());
  },
  save: async (file) => {
    download(file);
    // Every export keeps a version of the book as it was (unless it is the same as the last one).
    if (current) void saveVersion(current.project, "export", "", false);
    return t("web.downloaded", { name: file.name });
  },
  store,
  ask: async (d: Dialog) => {
    const buttons = [{ label: d.cancel ?? t("web.cancel"), value: "cancel" }];
    if (d.extra) buttons.push({ label: d.extra, value: "extra" });
    buttons.push({ label: d.ok, value: "ok", primary: true } as (typeof buttons)[number]);
    const r = await showDialog(d.title, d.message.split("\n\n").map((p) => h("p", { text: p })), buttons);
    return r === "ok" || r === "extra" ? r : "cancel";
  },
  notify: toast,
  openUrl: (url) => void window.open(url, "_blank", "noopener"),
  // Only a book project can be edited, so only then do the Problems list links.
  get openSource() {
    return current ? (src: SourceRef) => workspace.openSource(src) : undefined;
  },
  openLicense: () => {
    const box = h("div");
    renderLicensePanel(box, license, host, fetchPost);
    void showDialog("Book Studio Pro", [box], [{ label: t("web.done"), value: "ok", primary: true }]);
  },
  bookKey: (path) => (current ? `project:${current.project.id}/${path}` : `${folder?.name ?? ""}/${path}`),
  renderEmpty: (box) => {
    append(
      box,
      h("h2", { text: t("web.emptyTitle") }),
      h("p", { text: t("web.emptyHelp") }),
      h("div", { cls: "app-empty-actions" }, h("button", { cls: "mod-cta", text: t("web.openFolder"), on: { click: () => void pickFolder() } }), h("button", { text: t("web.trySample"), on: { click: () => void openSample() } })),
    );
  },
};

const license = new LicenseManager(host);
let studio = new Studio(host, $("studio"), license);

// The writing screen for book projects. The studio moves into its third column while a project is open.
const workspace = new Workspace($("workspace"), {
  save: putProject,
  changed: (project, saved) => {
    current = { project, vault: projectToVault(project) };
    studio.scheduleBuild(saved ? 200 : 900);
  },
  ask: (d) => host.ask(d),
  notify: toast,
  plan: () => license.plan(),
  cover: (opener) =>
    void openCoverEditor(
      {
        project: () => current?.project ?? null,
        change: (next) => workspace.applyProject(next),
        base: () => studio.coverBase(),
        plan: () => license.plan(),
        notify: toast,
        ask: (d) => host.ask(d),
      },
      opener,
    ),
  publish: () =>
    showPublishChecklist(
      {
        project: () => current?.project ?? null,
        facts: () => studio.publishFacts(),
        go: (place) => {
          if (place === "problems") {
            workspace.reveal("book");
            studio.showProblems();
          } else workspace.reveal(place);
        },
      },
      document.getElementById("ws-publish-btn") ?? undefined,
    ),
  versions: () =>
    showVersions(
      {
        project: () => current?.project ?? null,
        list: async () => (current ? listSnapshots(current.project.id) : []),
        save: async (name) => void (current && (await saveVersion(current.project, "manual", name, true))),
        restore: async (s) => {
          if (!current) return;
          await saveVersion(current.project, "before-restore", "", true);
          workspace.replaceProject(restoreSnapshot(current.project, s, Date.now()));
        },
        remove: (s) => deleteSnapshot(s.id),
        notify: toast,
      },
      document.getElementById("ws-versions-btn") ?? undefined,
    ),
  search: () =>
    showSearch(
      {
        project: () => current?.project ?? null,
        replaceAll: async (find, to, o) => {
          if (!current) return 0;
          const r = replaceAll(current.project, find, to, o, Date.now());
          if (!r.count) return 0;
          await saveVersion(current.project, "before-replace", "", true);
          workspace.replaceProject(r.project);
          return r.count;
        },
        open: (id) => workspace.openChapter(id),
      },
      document.getElementById("ws-search-btn") ?? undefined,
    ),
  backup: (p) => backupProject(p),
  exportWord: (p) => exportWordFile(p),
  // The preview bar remembers theme and trim per book; a choice made in the book form must not be hidden by an older one.
  layoutChanged: (project, keys) => {
    const key = `settings:project:${project.id}/${projectToVault(project).bookPath}`;
    const saved = store.get<Record<string, unknown>>(key);
    if (!saved) return;
    const rest = Object.fromEntries(Object.entries(saved).filter(([k]) => !keys.includes(k)));
    store.set(key, Object.keys(rest).length ? rest : undefined);
  },
});
// The first-book guide: four steps over the writing screen for a book that was just imported from the first screen.
const wizard = new Wizard($("wizard"), {
  project: () => workspace.current,
  change: (next, layout) => workspace.change(next, layout),
  plan: () => license.plan(),
  thumbnail: async (project, theme, trim, width) => themeThumbnail(project, theme, trim, await studio.fontSet(), width),
  moreDetails: () => workspace.reveal("details"),
  download: (kind) => void (kind === "pdf" ? studio.exportPdf() : kind === "cover" ? studio.exportCoverPdf() : studio.exportEpub()),
  facts: () => studio.publishFacts(),
  go: (place) => {
    if (place === "problems") {
      workspace.reveal("book");
      studio.showProblems();
    } else workspace.reveal(place);
  },
});
studio.onBuilt = () => wizard.refresh();
const studioParent = $("studio").parentElement as HTMLElement;
const studioNext = $("studio").nextSibling;

// Studio.refresh() reads the book source again when it resumes from listing the books. So a second book must not
// be opened while a refresh is still running, or the old refresh would build the old path from the new source.
let refreshing: Promise<void> = Promise.resolve();

function refreshStudio(): Promise<void> {
  refreshing = refreshing.then(() => studio.refresh());
  refreshing = refreshing.catch(() => undefined);
  return refreshing;
}

/** Put the studio in the writing screen (a project is open) or back in the page (a folder or the sample). */
function placeStudio(inWorkspace: boolean): void {
  const el = $("studio");
  if (inWorkspace) workspace.bookSlot.appendChild(el);
  else studioParent.insertBefore(el, studioNext);
}

// The page's own title (what search results show) stays while the sample is open.
const PAGE_TITLE_EN = doc.title;
const pageTitle = () => (locale === "en" ? PAGE_TITLE_EN : t("web.title"));

async function open(next: Folder): Promise<void> {
  await workspace.close();
  wizard.hide();
  await refreshing;
  placeStudio(false);
  current = null;
  folder = next;
  showStudio();
  doc.title = next.sample ? pageTitle() : t("web.pageTitle", { name: next.name });
  await refreshStudio();
}

// ── My books ──

function showStudio(): void {
  $("projects").hidden = true;
  $("studio").hidden = false;
}

/** Open a saved book: the studio reads the notes generated from it. */
async function openProject(project: Project, report?: string[]): Promise<void> {
  await workspace.close();
  wizard.hide();
  await refreshing;
  folder = null;
  current = { project, vault: projectToVault(project) };
  doc.title = t("web.pageTitle", { name: project.name });
  placeStudio(true);
  showStudio();
  workspace.open(project);
  wizard.show(report);
  await refreshStudio();
}

// ── Saved versions ──

/** Save a version of the book. An automatic one is skipped when nothing changed since the last version. */
async function saveVersion(p: Project, kind: SnapshotKind, name: string, force: boolean): Promise<void> {
  try {
    if (!force) {
      const last = (await listSnapshots(p.id))[0];
      if (last && sameContent(last.content, contentOf(p))) return;
    }
    await putSnapshot(makeSnapshot(p, kind, Date.now(), crypto.randomUUID(), name));
  } catch {
    // No storage for versions (private window): the book itself still works.
  }
}

// ── Copies and imports ──

/** Download a copy of a book as a zip and remember when. */
async function backupProject(p: Project): Promise<void> {
  const data = await exportZip(p);
  download({ name: zipName(p), data, mime: "application/zip" });
  store.set(`backup:${p.id}`, Date.now());
  toast(t("proj.backupDone", { name: p.name }));
}

/** Download a book as a Word file. The .docx is made in the browser, like the PDF and the EPUB. */
async function exportWordFile(p: Project): Promise<void> {
  const { projectToDocx } = await import("../project/export-docx");
  const data = await projectToDocx(p);
  const name = zipName(p).replace(/\.zip$/i, ".docx");
  download({ name, data, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  toast(t("proj.wordDone", { name: p.name }));
}

const newId = () => crypto.randomUUID();

/** Save what an import found and say what happened. */
async function saveImported(r: ImportResult): Promise<void> {
  if (!r.projects.length) {
    toast(t("proj.importedNone"));
    return;
  }
  for (const p of r.projects) await putProject(p);
  toast(r.projects.length === 1 ? t("proj.importedOne", { name: r.projects[0].name }) : t("proj.importedMany", { n: r.projects.length }));
  if (r.missing.length) toast(t("proj.importMissing", { n: r.missing.length }));
  if (r.skipped.length) toast(t("proj.importSkipped", { keys: [...new Set(r.skipped)].join(", ") }));
}

function filesOf(f: Folder): ImportFiles {
  return { paths: f.paths, text: async (p) => (await f.file(p)).text(), bytes: async (p) => new Uint8Array(await (await f.file(p)).arrayBuffer()) };
}

/** Ask for a folder without opening it in the studio. */
function chooseFolder(): Promise<Folder | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (picker) {
    return picker({ id: "book-studio", mode: "read" }).then(
      (dir) => folderFromHandle(dir),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return null;
        throw e;
      },
    );
  }
  return new Promise((resolve) => {
    const input = h("input", { attr: { type: "file", webkitdirectory: "", multiple: "", hidden: "" } });
    input.addEventListener("change", () => resolve(input.files?.length ? folderFromFiles(input.files) : null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** Seen-first-time stamp, so a brand-new book is not nagged about at once. */
function firstSeen(p: Project): number {
  const key = `seen:${p.id}`;
  const known = store.get<number>(key);
  if (known) return known;
  const now = Date.now();
  store.set(key, now);
  return now;
}

// Showing the list takes a moment; when two calls overlap (the page's own and a click), only the last one goes on.
let showing = 0;

async function showProjects(focus?: string): Promise<void> {
  const mine = ++showing;
  await workspace.close();
  wizard.hide();
  if (mine !== showing) return;
  placeStudio(false);
  $("studio").hidden = true;
  const box = $("projects");
  box.hidden = false;
  await renderProjects(
    box,
    {
      list: listProjects,
      create: async (name, template) => {
        const p = createProject({ id: crypto.randomUUID(), name, now: Date.now(), template, language: locale, firstChapterTitle: t("proj.firstChapter") });
        await putProject(p);
        return p;
      },
      importManuscript: async ({ text, bytes, fileName, name, guide }) => {
        const opts = { id: crypto.randomUUID(), now: Date.now(), name, fileName, language: locale, guide };
        if (bytes) {
          // The readers (Word, LibreOffice, RTF) are loaded only when someone imports that kind of file.
          const { importFile } = await import("../project/import-file");
          const { projectFromImport } = await import("../project/import-text");
          const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
          let imported = await importFile(bytes, parse, fileName);
          // A Word file with its own styles for chapter titles: ask once, then read it again with them as titles.
          const own = imported.report.titleStyles;
          if (own.length) {
            const names = own.map((x) => `«${x.name}» (${x.examples.map((e) => `“${e}”`).join(", ")})`).join("; ");
            const answer = await host.ask({ title: t("imp.styles.title"), message: t("imp.styles.message", { names }), ok: t("imp.styles.yes"), cancel: t("imp.styles.no") });
            if (answer === "ok") imported = await importFile(bytes, parse, fileName, { titleStyles: own.map((x) => x.id) });
          }
          const project = projectFromImport(imported, opts);
          await putProject(project);
          return { project, notes: imported.notes, report: imported.report };
        }
        const { project, imported } = projectFromText(text ?? "", opts);
        await putProject(project);
        return { project, notes: imported.notes };
      },
      rename: async (p, name) => putProject(renameProject(p, name, Date.now())),
      remove: async (p) => deleteProject(p.id),
      open: (p, report) => void openProject(p, report),
      ask: (d) => host.ask(d),
      notify: toast,
      backup: backupProject,
      lastBackup: (p) => store.get<number>(`backup:${p.id}`),
      backupDue: (p) => backupDue(Date.now(), { lastBackup: store.get<number>(`backup:${p.id}`), firstSeen: firstSeen(p), updatedAt: p.updatedAt }),
      importZip: async (file) => saveImported(await importZip(file, { now: Date.now(), newId })),
      importFolder: async () => {
        const f = await chooseFolder();
        if (f) await saveImported(await vaultToProjects(filesOf(f), { now: Date.now(), newId }));
      },
      sample: () => void openSample(),
      persisted: async () => {
        try {
          return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
        } catch {
          return false;
        }
      },
    },
    focus ?? "title",
  );
}

async function openSample(): Promise<void> {
  try {
    await open(await sampleFolder());
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

async function pickFolder(): Promise<void> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) {
    $<HTMLInputElement>("folder-input").click();
    return;
  }
  try {
    const dir = await picker({ id: "book-studio", mode: "read" });
    await setHandle("folder", dir);
    await open(await folderFromHandle(dir));
    updateReopen(dir);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    toast(e instanceof Error ? e.message : String(e));
  }
}

let reopenDir: DirHandle | undefined;

function updateReopen(dir: DirHandle | undefined): void {
  reopenDir = dir;
  const btn = $<HTMLButtonElement>("reopen-folder");
  btn.hidden = !dir;
  if (dir) btn.textContent = t("web.reopen", { name: dir.name });
}

// ── Language ──

/** Put the page's own texts (header, buttons, title) in the chosen language. */
function applyPageText(): void {
  doc.documentElement.lang = locale;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-i18n]"))) el.textContent = t(el.dataset.i18n as Parameters<typeof t>[0]);
  $("nav-source").setAttribute("aria-label", t("web.bookSource"));
  $("nav-guides").setAttribute("aria-label", t("web.guidesNav"));
  $("lang").setAttribute("aria-label", t("web.language"));
  $("noscript").textContent = t("web.noscript");
  doc.querySelector("#meta-description")?.setAttribute("content", t("web.description"));
  // The first guides link goes to the English pages; say so for screen readers when the app is in Spanish.
  if (locale === "es") $("guides-en").setAttribute("lang", "en");
  else $("guides-en").removeAttribute("lang");
  doc.title = current ? t("web.pageTitle", { name: current.project.name }) : folder && !folder.sample ? t("web.pageTitle", { name: folder.name }) : pageTitle();
  updateReopen(reopenDir);
  workspace.rerender();
  wizard.show();
  if (!$("projects").hidden) void showProjects();
}

/** Switch language and draw the studio again; the open folder and book stay as they are. */
async function changeLocale(next: Locale): Promise<void> {
  if (next === locale) return;
  locale = next;
  store.set("lang", next);
  setLocale(next);
  applyPageText();
  const book = studio.bookPath;
  if (book) store.set("lastBook", book);
  studio.dispose();
  studio = new Studio(host, $("studio"), license);
  studio.onBuilt = () => wizard.refresh();
  await refreshStudio();
}

// Best effort: keep the last words if the page is closed while a save is waiting.
window.addEventListener("pagehide", () => void workspace.flush());

const langSelect = $<HTMLSelectElement>("lang");
langSelect.value = locale;
langSelect.addEventListener("change", () => void changeLocale(langSelect.value === "es" ? "es" : "en"));

$("open-folder").addEventListener("click", () => void pickFolder());
$("open-sample").addEventListener("click", () => void openSample());
// Already on the list: leave it as it is, so what someone has started typing is not drawn over.
$("open-projects").addEventListener("click", () => {
  if (!$("projects").hidden) $("proj-title")?.focus();
  else void showProjects();
});
$<HTMLInputElement>("folder-input").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) void open(folderFromFiles(input.files));
  input.value = "";
});
$("reopen-folder").addEventListener("click", () => {
  void (async () => {
    const dir = await getHandle<DirHandle>("folder");
    if (!dir) return;
    const granted = (await dir.queryPermission?.({ mode: "read" })) === "granted" || (await dir.requestPermission?.({ mode: "read" })) === "granted";
    if (granted) await open(await folderFromHandle(dir));
  })();
});

// Offline: save the app on the device, and offer a new version without reloading under the person's hands.
registerPwa({
  ready: () => toast(t("pwa.ready")),
  update: (apply) => {
    if (doc.getElementById("update-bar")) return;
    const bar = h(
      "div",
      { cls: "app-update", attr: { id: "update-bar", role: "status" } },
      h("span", { text: t("pwa.update") }),
      h("button", { cls: "mod-cta", text: t("pwa.reload"), attr: { type: "button" }, on: { click: () => void workspace.flush().finally(apply) } }),
    );
    doc.body.insertBefore(bar, doc.body.firstChild);
  },
});

void (async () => {
  applyPageText();
  updateReopen(await getHandle<DirHandle>("folder"));
  // First thing a visitor sees: their own books, or when they have none, the promise and a place to drop their Word file.
  // A link that names a sample (the guides use them) opens that sample; `?start=import` goes to the file chooser.
  const params = new URLSearchParams(location.search);
  if (params.has("sample")) await openSample();
  else await showProjects(params.get("start") === "import" ? "import" : undefined);
})();
