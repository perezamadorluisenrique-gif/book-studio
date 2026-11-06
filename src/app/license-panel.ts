// License controls for the web app's dialog. The Obsidian plugin shows the
// same choices in its settings tab with Obsidian's own controls.

import { PRO_PREVIEW } from "../config";
import { PRO_FEATURES } from "../engine/entitlements";
import type { Post } from "../engine/license-online";
import { SALES_PAGE } from "../engine/pro-config";
import { append, clear, h } from "./dom";
import type { StudioHost } from "./host";
import { LicenseError, type LicenseManager } from "./license-manager";
import { t } from "./ui-i18n";

/** Read the text of a .bslicense file the person picked. */
export function pickLicenseFile(onText: (text: string) => void): void {
  const input = h("input", { attr: { type: "file", accept: ".bslicense,.txt,text/plain" } });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void file.text().then(onText);
  });
  input.click();
}

export function renderLicensePanel(container: HTMLElement, license: LicenseManager, host: Pick<StudioHost, "openUrl">, post: Post): void {
  const draw = () => {
    clear(container);
    const box = h("div", { cls: "bs-license" });
    append(box, h("p", { text: license.previewPro ? t("lic.previewOn") : license.describe() }));
    append(box, h("p", { text: t("lic.adds") }), h("ul", null, ...Object.values(PRO_FEATURES).map((f) => h("li", { text: f }))));

    const error = h("p", { cls: "bs-error", attr: { role: "alert" } });
    if (!license.configured) {
      append(box, h("p", { text: t("lic.noPlan") }));
    } else if (license.key) {
      append(box, h("div", { cls: "bs-license-row" }, h("button", { text: t("lic.remove"), on: { click: () => (license.remove(), draw()) } })));
    } else {
      const id = `bs-key-${Math.random().toString(36).slice(2, 8)}`;
      const input = h("input", { attr: { id, type: "text", autocomplete: "off", spellcheck: "false", placeholder: t("lic.placeholder") } });
      const activate = h("button", { cls: "mod-cta", text: t("lic.activate") });
      const run = (text: string) => {
        error.textContent = "";
        activate.disabled = true;
        license
          .activate(text, post)
          .then(() => draw())
          .catch((e: unknown) => {
            error.textContent = e instanceof LicenseError ? e.message : t("lic.failed");
            activate.disabled = false;
          });
      };
      activate.addEventListener("click", () => run(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") run(input.value);
      });
      append(
        box,
        h("label", { attr: { for: id }, text: t("lic.keyLabel") }),
        h("div", { cls: "bs-license-row" }, input, activate, h("button", { text: t("lic.importFile"), on: { click: () => pickLicenseFile(run) } })),
      );
    }
    append(box, error);
    if (license.configured) {
      append(box, h("div", { cls: "bs-license-row" }, h("button", { text: t("lic.getPro"), on: { click: () => host.openUrl(SALES_PAGE) } })));
    }
    if (PRO_PREVIEW) {
      const toggle = h("input", { attr: { type: "checkbox", checked: license.previewPro } });
      toggle.addEventListener("change", () => {
        license.previewPro = toggle.checked;
        draw();
      });
      append(box, h("label", { cls: "bs-check" }, toggle, t("lic.tryNoKey")));
    }
    append(box, h("p", { cls: "bs-where", text: t("lic.privacy") }));
    container.appendChild(box);
  };
  draw();
}
