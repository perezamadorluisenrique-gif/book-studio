// The "My books" screen of the web app: create a book (blank or from the Starter Book template),
// see the list, open, rename or delete one. It draws the screen and calls back; it saves nothing itself.

import { append, clear, h } from "../app/dom";
import type { Dialog } from "../app/host";
import { t, tn, getLocale } from "../app/ui-i18n";
import type { Project } from "../project/model";

export interface ProjectsDeps {
  list(): Promise<Project[]>;
  create(name: string, template: boolean): Promise<Project>;
  /** Make a book from a manuscript's text; `fileName` is empty when the text was pasted. */
  importText(text: string, fileName: string, name: string): Promise<{ project: Project; notes: string[] }>;
  rename(p: Project, name: string): Promise<void>;
  remove(p: Project): Promise<void>;
  open(p: Project): void;
  ask(d: Dialog): Promise<"ok" | "cancel" | "extra">;
  notify(message: string): void;
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

  const pasteBox = h("textarea", { attr: { id: "imp-text", rows: "6", "aria-describedby": "imp-hint" } });
  const fileInput = h("input", { attr: { type: "file", id: "imp-file", accept: ".md,.markdown,.txt,text/plain,text/markdown", "aria-describedby": "imp-hint" } });
  const importName = h("input", { attr: { type: "text", id: "imp-name", autocomplete: "off", value: "" } });
  const importForm = h(
    "form",
    {
      cls: "proj-new proj-import",
      attr: { "aria-labelledby": "imp-title" },
      on: {
        submit: (ev: Event) => {
          ev.preventDefault();
          void (async () => {
            try {
              const file = fileInput.files?.[0];
              const text = file ? await file.text() : pasteBox.value;
              if (!text.trim()) {
                deps.notify(t("imp.empty"));
                return;
              }
              const { project, notes } = await deps.importText(text, file?.name ?? "", importName.value.trim());
              const extra = notes.includes("intro") ? ` ${t("imp.intro")}` : "";
              deps.notify(`${tn("imp.done", project.chapters.length, { name: project.name })}${extra}`);
              deps.open(project);
            } catch (e) {
              fail(deps, e);
            }
          })();
        },
      },
    },
    h("h3", { text: t("imp.title"), attr: { id: "imp-title" } }),
    h("p", { cls: "proj-hint", text: t("imp.hint"), attr: { id: "imp-hint" } }),
    h("label", { attr: { for: "imp-file" }, text: t("imp.file") }),
    fileInput,
    h("label", { attr: { for: "imp-text" }, text: t("imp.paste") }),
    pasteBox,
    h("label", { attr: { for: "imp-name" }, text: t("imp.name") }),
    importName,
    h("button", { cls: "mod-cta", text: t("imp.go"), attr: { type: "submit" } }),
  );

  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium" });
  const list = h("ul", { cls: "proj-list", attr: { "aria-label": t("proj.listLabel") } });
  for (const p of projects) list.appendChild(row(p));

  function row(p: Project): HTMLElement {
    const li = h("li", { cls: "proj-item", attr: { "data-id": p.id } });
    const info = h(
      "div",
      { cls: "proj-info" },
      h("strong", { cls: "proj-name", text: p.name }),
      h("span", { cls: "proj-sub", text: `${tn("proj.chapters", p.chapters.length)} · ${t("proj.updated", { date: date.format(p.updatedAt) })}` }),
    );
    const btn = (label: string, aria: string, fn: () => void, cls?: string) => h("button", { cls, text: label, attr: { type: "button", "aria-label": aria }, on: { click: fn } });
    const actions = h(
      "div",
      { cls: "proj-actions" },
      btn(t("proj.open"), t("proj.openLabel", { name: p.name }), () => deps.open(p), "mod-cta"),
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
    form,
    importForm,
    projects.length ? list : h("p", { cls: "proj-none", text: t("proj.none") }),
  );

  // Put the keyboard focus somewhere sensible after a change.
  if (focus === "new") nameInput.focus();
  else if (focus?.startsWith("rename:")) box.querySelector<HTMLElement>(`[data-id="${focus.slice(7)}"] button:nth-of-type(2)`)?.focus();
  else if (focus === "title") box.querySelector<HTMLElement>("#proj-title")?.focus();
}
