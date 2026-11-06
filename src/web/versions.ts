// The "Saved versions" window: save a version by hand, see the list, restore or delete one.
// A native modal <dialog> (the keyboard stays inside, Esc closes it). It only draws and calls back.

import { clear, h } from "../app/dom";
import { getLocale, t, tn } from "../app/ui-i18n";
import type { Project } from "../project/model";
import { wordCount, type Snapshot } from "../project/snapshots";

export interface VersionsDeps {
  project(): Project | null;
  list(): Promise<Snapshot[]>;
  save(name: string): Promise<void>;
  restore(s: Snapshot): Promise<void>;
  remove(s: Snapshot): Promise<void>;
  notify(message: string): void;
}

export function showVersions(deps: VersionsDeps, opener?: HTMLElement): void {
  if (!deps.project()) return;
  const dialog = h("dialog", { cls: "pub-dialog ver-dialog", attr: { "aria-labelledby": "ver-title" } });
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" });
  const status = h("p", { cls: "ver-status", attr: { role: "status" } });
  const listBox = h("div");
  const nameInput = h("input", { attr: { type: "text", id: "ver-name", autocomplete: "off", value: "" } });

  const fail = (e: unknown) => (status.textContent = e instanceof Error ? e.message : String(e));

  async function draw(focus?: string): Promise<void> {
    const all = await deps.list();
    clear(listBox);
    if (!all.length) {
      listBox.appendChild(h("p", { cls: "ver-none", text: t("ver.none") }));
      return;
    }
    const ul = h("ul", { cls: "ver-list", attr: { "aria-label": t("ver.list") } });
    for (const s of all) {
      const when = date.format(s.at);
      const label = [t(`ver.kind.${s.kind}`), s.name].filter(Boolean).join(": ");
      const btn = (text: string, aria: string, fn: () => void, cls?: string) => h("button", { cls, text, attr: { type: "button", "aria-label": aria, "data-id": s.id }, on: { click: fn } });
      ul.appendChild(
        h(
          "li",
          { cls: "ver-item", attr: { "data-id": s.id } },
          h("div", { cls: "ver-info" }, h("strong", { text: when }), h("span", { cls: "ver-sub", text: `${label} · ${tn("proj.chapters", s.content.chapters.length)} · ${t("ver.words", { n: wordCount(s.content) })}` })),
          h(
            "div",
            { cls: "ver-actions" },
            btn(t("ver.restore"), t("ver.restoreLabel", { date: when }), () => {
              void deps.restore(s).then(
                async () => {
                  status.textContent = t("ver.restored");
                  await draw("status");
                },
                fail,
              );
            }),
            btn(t("ver.delete"), t("ver.deleteLabel", { date: when }), () => {
              void deps.remove(s).then(
                async () => {
                  status.textContent = t("ver.deleted");
                  await draw("name");
                },
                fail,
              );
            }),
          ),
        ),
      );
    }
    listBox.appendChild(ul);
    if (focus === "name") nameInput.focus();
  }

  const form = h(
    "form",
    {
      cls: "ver-new",
      on: {
        submit: (ev: Event) => {
          ev.preventDefault();
          void deps.save(nameInput.value).then(async () => {
            nameInput.value = "";
            status.textContent = t("ver.saved");
            await draw();
          }, fail);
        },
      },
    },
    h("label", { attr: { for: "ver-name" }, text: t("ver.name") }),
    nameInput,
    h("button", { cls: "mod-cta", text: t("ver.save"), attr: { type: "submit" } }),
  );

  dialog.append(
    h("h2", { text: t("ver.title"), attr: { id: "ver-title" } }),
    h("p", { text: t("ver.intro") }),
    form,
    status,
    listBox,
    h("div", { cls: "pub-actions" }, h("button", { text: t("ver.close"), attr: { type: "button" }, on: { click: () => dialog.close() } })),
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    opener?.focus();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  void draw().catch(fail);
}
