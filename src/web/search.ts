// The "Find and replace" window for the whole book. A native modal <dialog>; it only draws and calls back,
// the matching is in project/search.ts.

import { clear, h } from "../app/dom";
import { t, tn } from "../app/ui-i18n";
import type { Project } from "../project/model";
import { findAll, type FindOptions } from "../project/search";

export interface SearchDeps {
  project(): Project | null;
  /** Replace every match. Saves a version first; resolves with how many were replaced. */
  replaceAll(find: string, to: string, o: FindOptions): Promise<number>;
  /** Close the window and show a chapter in the editor. */
  open(chapterId: string): void;
}

export function showSearch(deps: SearchDeps, opener?: HTMLElement): void {
  if (!deps.project()) return;
  const dialog = h("dialog", { cls: "pub-dialog find-dialog", attr: { "aria-labelledby": "find-title" } });
  const findInput = h("input", { attr: { type: "text", id: "find-text", autocomplete: "off", value: "" } });
  const toInput = h("input", { attr: { type: "text", id: "find-to", autocomplete: "off", value: "" } });
  const caseBox = h("input", { attr: { type: "checkbox", id: "find-case" } });
  const wordBox = h("input", { attr: { type: "checkbox", id: "find-word" } });
  const status = h("p", { cls: "find-status", attr: { role: "status" } });
  const results = h("div");
  const go = h("button", { cls: "mod-cta", text: t("find.all"), attr: { type: "button", id: "find-all", disabled: true } });
  const options = (): FindOptions => ({ matchCase: (caseBox).checked, wholeWord: (wordBox).checked });
  let said = ""; // A message from the last replace stays until the person types again.

  function update(): void {
    const p = deps.project();
    clear(results);
    const find = (findInput).value;
    if (!p || !find) {
      status.textContent = said || t("find.type");
      (go).disabled = true;
      return;
    }
    const found = findAll(p, find, options());
    (go).disabled = found.total === 0;
    status.textContent = said || (found.total ? tn("find.count", found.total) : t("find.zero"));
    if (!found.total) return;
    const ul = h("ul", { cls: "find-list", attr: { "aria-label": t("find.list") } });
    for (const c of found.chapters) {
      ul.appendChild(
        h(
          "li",
          { cls: "find-item" },
          h("span", { cls: "find-title", text: c.title }),
          h("span", { cls: "find-n", text: tn("find.count", c.count) }),
          h("button", { text: t("find.go"), attr: { type: "button", "aria-label": t("find.in", { title: c.title }) }, on: { click: () => (dialog.close(), deps.open(c.id)) } }),
        ),
      );
    }
    results.appendChild(ul);
  }

  const typed = () => {
    said = "";
    update();
  };
  for (const el of [findInput, caseBox, wordBox]) el.addEventListener("input", typed);
  go.addEventListener("click", () => {
    const find = (findInput).value;
    void deps.replaceAll(find, (toInput).value, options()).then((n) => {
      said = tn("find.replaced", n);
      update();
    });
  });

  const field = (id: string, label: string, input: HTMLElement) => h("div", { cls: "find-field" }, h("label", { attr: { for: id }, text: label }), input);
  const check = (id: string, label: string, input: HTMLElement) => h("label", { cls: "proj-radio", attr: { for: id } }, input, h("span", { text: label }));
  dialog.append(
    h("h2", { text: t("find.title"), attr: { id: "find-title" } }),
    h("p", { text: t("find.intro") }),
    field("find-text", t("find.find"), findInput),
    field("find-to", t("find.replace"), toInput),
    h("div", { cls: "find-options" }, check("find-case", t("find.case"), caseBox), check("find-word", t("find.word"), wordBox)),
    status,
    results,
    h("div", { cls: "pub-actions" }, go, h("button", { text: t("find.close"), attr: { type: "button" }, on: { click: () => dialog.close() } })),
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    opener?.focus();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  update();
  findInput.focus();
}
