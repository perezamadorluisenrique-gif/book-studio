// The web app: the same studio as the Obsidian plugin, reading a folder of
// Markdown notes from the computer (or the bundled sample book). Notes are read
// in the browser and outputs are downloaded; nothing is uploaded anywhere.

import { append, clear, h, setElementFactory } from "../app/dom";
import type { BookChoice, Dialog, OutputFile, Store, StudioHost } from "../app/host";
import { renderLicensePanel } from "../app/license-panel";
import { LicenseManager } from "../app/license-manager";
import { Studio } from "../app/studio";
import type { VaultSource } from "../engine/book";
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

async function sampleFolder(): Promise<Folder> {
  const base = new URL("sample/oz/", doc.baseURI);
  const res = await fetch(new URL("files.json", base));
  if (!res.ok) throw new Error("The sample book couldn't be loaded.");
  const paths = (await res.json()) as string[];
  return {
    name: "Sample",
    sample: true,
    paths,
    file: async (p) => {
      const r = await fetch(new URL(p.split("/").map(encodeURIComponent).join("/"), base));
      if (!r.ok) throw new Error(`Missing sample file ${p}`);
      return r.blob();
    },
  };
}

function need<T>(v: T | undefined, path: string): T {
  if (v === undefined) throw new Error(`File not found: ${path}`);
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

// ── Remembering the folder (IndexedDB holds the handle; permission is asked again) ──

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("book-studio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idb();
    return await new Promise<T | undefined>((resolve) => {
      const req = db.transaction("handles").objectStore("handles").get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Private windows may have no IndexedDB; the folder just isn't remembered.
  }
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
const store = localStore();

const host: StudioHost = {
  kind: "web",
  source: () => (folder ? vaultFor(folder) : null),
  listBooks: () => (folder ? findBooks(folder) : Promise.resolve([])),
  loadFont: async (f: FontFile) => {
    const res = await fetch(new URL(`fonts/${f}.ttf`, doc.baseURI));
    if (!res.ok) throw new Error(`Couldn't load the font ${f}.`);
    return new Uint8Array(await res.arrayBuffer());
  },
  save: async (file) => {
    download(file);
    return `Downloaded ${file.name}`;
  },
  store,
  ask: async (d: Dialog) => {
    const buttons = [{ label: d.cancel ?? "Cancel", value: "cancel" }];
    if (d.extra) buttons.push({ label: d.extra, value: "extra" });
    buttons.push({ label: d.ok, value: "ok", primary: true } as (typeof buttons)[number]);
    const r = await showDialog(d.title, d.message.split("\n\n").map((p) => h("p", { text: p })), buttons);
    return r === "ok" || r === "extra" ? r : "cancel";
  },
  notify: toast,
  openUrl: (url) => void window.open(url, "_blank", "noopener"),
  openLicense: () => {
    const box = h("div");
    renderLicensePanel(box, license, host);
    void showDialog("Book Studio Pro", [box], [{ label: "Done", value: "ok", primary: true }]);
  },
  bookKey: (path) => `${folder?.name ?? ""}/${path}`,
  renderEmpty: (box) => {
    append(
      box,
      h("h2", { text: "Open a folder of notes" }),
      h("p", { text: "Choose the folder that holds your book note and its chapters, such as an Obsidian vault. Book Studio reads it in this browser; nothing is uploaded." }),
      h("div", { cls: "app-empty-actions" }, h("button", { cls: "mod-cta", text: "Open a folder", on: { click: () => void pickFolder() } }), h("button", { text: "Try the sample book", on: { click: () => void openSample() } })),
    );
  },
};

const license = new LicenseManager(host);
const studio = new Studio(host, $("studio"), license);

async function open(next: Folder): Promise<void> {
  folder = next;
  doc.title = next.sample ? "Book Studio" : `${next.name} · Book Studio`;
  await studio.refresh();
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
    await idbSet("folder", dir);
    await open(await folderFromHandle(dir));
    updateReopen(dir);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    toast(e instanceof Error ? e.message : String(e));
  }
}

function updateReopen(dir: DirHandle | undefined): void {
  const btn = $<HTMLButtonElement>("reopen-folder");
  btn.hidden = !dir;
  if (dir) btn.textContent = `Reopen “${dir.name}”`;
}

$("open-folder").addEventListener("click", () => void pickFolder());
$("open-sample").addEventListener("click", () => void openSample());
$<HTMLInputElement>("folder-input").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) void open(folderFromFiles(input.files));
  input.value = "";
});
$("reopen-folder").addEventListener("click", () => {
  void (async () => {
    const dir = await idbGet<DirHandle>("folder");
    if (!dir) return;
    const granted = (await dir.queryPermission?.({ mode: "read" })) === "granted" || (await dir.requestPermission?.({ mode: "read" })) === "granted";
    if (granted) await open(await folderFromHandle(dir));
  })();
});

void (async () => {
  updateReopen(await idbGet<DirHandle>("folder"));
  // First thing a visitor sees: the sample book, typeset.
  await openSample();
})();
