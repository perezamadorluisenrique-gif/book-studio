// The "My books" screen of the web app: create a book (blank or from the Starter Book template),
// see the list, open, rename or delete one. It draws the screen and calls back; it saves nothing itself.

import { append, clear, h } from "../app/dom";
import type { Dialog } from "../app/host";
import { t, tn, getLocale } from "../app/ui-i18n";
import type { Project } from "../project/model";

export interface ProjectsDeps {
  list(): Promise<Project[]>;
  create(name: string, template: boolean): Promise<Project>;
  rename(p: Project, name: string): Promise<void>;
  remove(p: Project): Promise<void>;
  open(p: Project): void;
  ask(d: Dialog): Promise<"ok" | "cancel" | "extra">;
  notify(message: string): void;
  /** Download a copy of the book as a .zip. */
  backup(p: Project): Promise<void>;
  /** When the book was last downloaded, if ever. */
  lastBackup(p: Project): number | undefined;
  /** True when the book changed and its last copy is over a week old. */
  backupDue(p: Project): boolean;
  /** Make books from a .zip (a copy, or any zipped folder of notes). */
  importZip(file: File): Promise<void>;
  /** Ask for a folder of Markdown notes and make a book from it. */
  importFolder(): Promise<void>;
  /** Whether the browser promised to keep the books (false: it may clear them when space is short). */
  persisted(): Promise<boolean>;
}

function fail(deps: ProjectsDeps, e: unknown): void {
  deps.notify(t("proj.failed", { error: e instanceof Error ? e.message : String(e) }));
}

/** Draw the whole screen inside `box`; call it again after anything changes. */
export async function renderProjects(box: HTMLElement, deps: ProjectsDeps, focus?: string): Promise<void> {
  let projects: Project[] = [];
  try {
    projects = await deps.list();
  } catch (e) {
    fail(deps, e);
  }
  const again = (f?: string) => void renderProjects(box, deps, f);
  // A quiet reminder (not a pop-up): which books have no recent copy, and whether the browser may clear them.
  const due = projects.filter((p) => deps.backupDue(p));
  const note = h("div", { cls: "proj-note", attr: { role: "status" } });
  if (due.length) note.appendChild(h("p", { text: t("proj.backupDue", { names: due.map((p) => `“${p.name}”`).join(", ") }) }));
  if (projects.length) {
    void deps.persisted().then((ok) => {
      if (!ok) note.appendChild(h("p", { text: t("proj.notPersisted") }));
    });
  }

  clear(box);
  const nameInput = h("input", { attr: { type: "text", id: "proj-name", autocomplete: "off", value: "" } });
  nameInput.placeholder = t("proj.defaultName");
  const radio = (value: string, label: string, checked: boolean) =>
    h("label", { cls: "proj-radio" }, h("input", { attr: { type: "radio", name: "proj-kind", value, checked } }), h("span", { text: label }));
  const form = h(
    "form",
    {
      cls: "proj-new",
      attr: { "aria-labelledby": "proj-new-title" },
      on: {
        submit: (ev: Event) => {
          ev.preventDefault();
          const template = (form.querySelector<HTMLInputElement>("input[name=proj-kind]:checked")?.value ?? "blank") === "template";
          const name = nameInput.value.trim() || t("proj.defaultName");
          deps.create(name, template).then(
            (p) => {
              deps.notify(t("proj.created", { name: p.name }));
              deps.open(p);
            },
            (e: unknown) => fail(deps, e),
          );
        },
      },
    },
    h("h3", { text: t("proj.newTitle"), attr: { id: "proj-new-title" } }),
    h("label", { attr: { for: "proj-name" }, text: t("proj.name") }),
    nameInput,
    h("fieldset", null, h("legend", { text: t("proj.startFrom") }), radio("blank", t("proj.blank"), true), radio("template", t("proj.template"), false)),
    h("button", { cls: "mod-cta", text: t("proj.create"), attr: { type: "submit" } }),
  );

  const zipInput = h("input", { attr: { type: "file", accept: ".zip,application/zip", hidden: "", "aria-label": t("proj.importZip"), tabindex: "-1" } });
  zipInput.addEventListener("change", () => {
    const file = zipInput.files?.[0];
    zipInput.value = "";
    if (file) void deps.importZip(file).then(() => again("title"), (e: unknown) => fail(deps, e));
  });
  const importBox = h(
    "div",
    { cls: "proj-import", attr: { role: "group", "aria-labelledby": "proj-import-title" } },
    h("h3", { text: t("proj.importTitle"), attr: { id: "proj-import-title" } }),
    h("p", { text: t("proj.importHelp") }),
    h("button", { text: t("proj.importZip"), attr: { type: "button", id: "proj-import-zip" }, on: { click: () => zipInput.click() } }),
    h("button", { text: t("proj.importFolder"), attr: { type: "button", id: "proj-import-folder" }, on: { click: () => void deps.importFolder().then(() => again("title"), (e: unknown) => fail(deps, e)) } }),
    zipInput,
  );

  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium" });
  const list = h("ul", { cls: "proj-list", attr: { "aria-label": t("proj.listLabel") } });
  for (const p of projects) list.appendChild(row(p));

  function row(p: Project): HTMLElement {
    const li = h("li", { cls: "proj-item", attr: { "data-id": p.id } });
    const last = deps.lastBackup(p);
    const info = h(
      "div",
      { cls: "proj-info" },
      h("strong", { cls: "proj-name", text: p.name }),
      h("span", { cls: "proj-sub", text: `${tn("proj.chapters", p.chapters.length)} · ${t("proj.updated", { date: date.format(p.updatedAt) })} · ${last ? t("proj.backedUp", { date: date.format(last) }) : t("proj.neverBackedUp")}` }),
    );
    const btn = (label: string, aria: string, fn: () => void, cls?: string) => h("button", { cls, text: label, attr: { type: "button", "aria-label": aria }, on: { click: fn } });
    const actions = h(
      "div",
      { cls: "proj-actions" },
      btn(t("proj.open"), t("proj.openLabel", { name: p.name }), () => deps.open(p), "mod-cta"),
      btn(t("proj.backup"), t("proj.backupLabel", { name: p.name }), () => {
        void deps.backup(p).then(
          () => again(`backup:${p.id}`),
          (e: unknown) => fail(deps, e),
        );
      }),
      btn(t("proj.rename"), t("proj.renameLabel", { name: p.name }), () => editing(li, p)),
      btn(t("proj.delete"), t("proj.deleteLabel", { name: p.name }), () => {
        void (async () => {
          const r = await deps.ask({ title: t("proj.deleteTitle"), message: t("proj.deleteMessage", { name: p.name }), ok: t("proj.deleteOk"), cancel: t("proj.cancel") });
          if (r !== "ok") return;
          try {
            await deps.remove(p);
            deps.notify(t("proj.deleted", { name: p.name }));
          } catch (e) {
            fail(deps, e);
          }
          again("new");
        })();
      }),
    );
    append(li, info, actions);
    return li;
  }

  /** Swap a row's name for a small form with the name to change. */
  function editing(li: HTMLElement, p: Project): void {
    const input = h("input", { attr: { type: "text", id: `proj-rename-${p.id}`, value: p.name, "aria-label": t("proj.newName") } });
    input.value = p.name;
    const f = h(
      "form",
      {
        cls: "proj-rename",
        on: {
          submit: (ev: Event) => {
            ev.preventDefault();
            const name = input.value.trim();
            void (async () => {
              if (name && name !== p.name) {
                try {
                  await deps.rename(p, name);
                  deps.notify(t("proj.renamed", { name }));
                } catch (e) {
                  fail(deps, e);
                }
              }
              again(`rename:${p.id}`);
            })();
          },
        },
      },
      input,
      h("button", { cls: "mod-cta", text: t("proj.save"), attr: { type: "submit" } }),
      h("button", { text: t("proj.cancel"), attr: { type: "button" }, on: { click: () => again(`rename:${p.id}`) } }),
    );
    clear(li);
    li.appendChild(f);
    input.focus();
    input.select();
  }

  append(
    box,
    h("h2", { text: t("proj.title"), attr: { id: "proj-title", tabindex: "-1" } }),
    h("p", { cls: "proj-intro", text: t("proj.intro") }),
    note,
    form,
    importBox,
    projects.length ? list : h("p", { cls: "proj-none", text: t("proj.none") }),
  );

  // Put the keyboard focus somewhere sensible after a change.
  if (focus === "new") nameInput.focus();
  else if (focus?.startsWith("rename:")) box.querySelector<HTMLElement>(`[data-id="${focus.slice(7)}"] button:nth-of-type(3)`)?.focus();
  else if (focus?.startsWith("backup:")) box.querySelector<HTMLElement>(`[data-id="${focus.slice(7)}"] button:nth-of-type(2)`)?.focus();
  else if (focus === "title") box.querySelector<HTMLElement>("#proj-title")?.focus();
}
