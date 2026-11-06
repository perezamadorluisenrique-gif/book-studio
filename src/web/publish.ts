// The "Publish checklist" window: what is still missing before the book goes to KDP, with a button
// to the place that fixes each item, and the steps to take on KDP afterwards. It is a native modal
// <dialog>, so the keyboard stays inside it and Esc closes it. It only draws; the rules are in project/checklist.ts.

import { clear, h } from "../app/dom";
import { t, tn, getLocale } from "../app/ui-i18n";
import { publishChecklist, type BuiltFacts, type CheckItem, type FixPlace } from "../project/checklist";
import type { Project } from "../project/model";

export interface PublishDeps {
  project(): Project | null;
  facts(): BuiltFacts | null;
  /** Close the window and take the person to the place that fixes the item. */
  go(place: FixPlace): void;
}

const MESSAGE = (item: CheckItem): string => {
  switch (item.id) {
    case "chapters":
      return item.n ? tn("pub.i.chaptersEmpty", item.n) : t("pub.i.chaptersNone");
    case "problems":
      return item.status === "ok" ? t("pub.i.problemsOk") : item.n === undefined ? t("pub.i.notBuilt") : tn("pub.i.problems", item.n);
    case "alt":
      return item.status === "ok" ? t("pub.i.altOk") : item.n === undefined ? t("pub.i.notBuilt") : tn("pub.i.alt", item.n);
    default:
      return t(`pub.i.${item.id}.${item.status === "ok" ? "ok" : "no"}`);
  }
};

const GUIDE = { en: "en/format-a-book-for-kdp/", es: "es/como-formatear-un-libro-para-kdp/" };

/** Open the window; it removes itself from the page when it closes. */
export function showPublishChecklist(deps: PublishDeps, opener?: HTMLElement): void {
  const project = deps.project();
  if (!project) return;
  const list = publishChecklist(project, deps.facts());
  const dialog = h("dialog", { cls: "pub-dialog", attr: { "aria-labelledby": "pub-title" } });

  const rows = list.items.map((item) => {
    const mark = item.status === "ok" ? t("pub.done") : item.status === "todo" ? t("pub.todo") : t("pub.tip");
    const li = h(
      "li",
      { cls: `pub-item pub-${item.status}` },
      h("span", { cls: "pub-mark", text: mark }),
      h("span", { cls: "pub-text", text: MESSAGE(item) }),
    );
    if (item.status !== "ok" && item.fix) {
      const fix = item.fix;
      li.appendChild(h("button", { text: t(`pub.fix.${fix}`), attr: { type: "button" }, on: { click: () => (dialog.close(), deps.go(fix)) } }));
    }
    return li;
  });

  const f = list.facts;
  const lang = getLocale();
  const steps = h("ol", { cls: "pub-steps" }, ...(["pub.step1", "pub.step2", "pub.step3", "pub.step4", "pub.step5"] as const).map((k) => h("li", { text: t(k) })));
  const content = [
    h("h2", { text: t("pub.title"), attr: { id: "pub-title" } }),
    h("p", { cls: list.ready ? "pub-summary pub-ready" : "pub-summary", text: list.ready ? t("pub.ready") : t("pub.notReady"), attr: { role: "status" } }),
    h("ul", { cls: "pub-list", attr: { "aria-label": t("pub.title") } }, ...rows),
  ];
  if (f) content.push(h("p", { cls: "pub-spine", text: t("pub.spine", { pages: f.pages, spine: f.spine.toFixed(3) }) }));
  content.push(
    h("h3", { text: t("pub.stepsTitle") }),
    steps,
    h("p", null, h("a", { text: t("pub.guide"), attr: { href: GUIDE[lang], target: "_blank", rel: "noopener" } })),
    h("div", { cls: "pub-actions" }, h("button", { cls: "mod-cta", text: t("pub.close"), attr: { type: "button" }, on: { click: () => dialog.close() } })),
  );
  clear(dialog);
  dialog.append(...content);
  dialog.addEventListener("close", () => {
    dialog.remove();
    opener?.focus();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}
