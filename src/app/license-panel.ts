// License controls for the web app's dialog. The Obsidian plugin shows the
// same choices in its settings tab with Obsidian's own controls.

import { PRO_PREVIEW } from "../config";
import { PRO_FEATURES } from "../engine/entitlements";
import type { Post } from "../engine/license-online";
import { SALES_PAGE } from "../engine/pro-config";
import { append, clear, h } from "./dom";
import type { StudioHost } from "./host";
import { LicenseError, type LicenseManager } from "./license-manager";

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
    append(box, h("p", { text: license.previewPro ? "Pro preview is on. Exports include every Pro feature in this developer build." : license.describe() }));
    append(box, h("p", { text: "Book Studio Pro adds:" }), h("ul", null, ...Object.values(PRO_FEATURES).map((f) => h("li", { text: f }))));

    const error = h("p", { cls: "bs-error", attr: { role: "alert" } });
    if (!license.configured) {
      append(box, h("p", { text: "This edition has no Pro plan, so there is no license key to enter." }));
    } else if (license.key) {
      append(box, h("div", { cls: "bs-license-row" }, h("button", { text: "Remove key from this browser", on: { click: () => (license.remove(), draw()) } })));
    } else {
      const id = `bs-key-${Math.random().toString(36).slice(2, 8)}`;
      const input = h("input", { attr: { id, type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Your license key" } });
      const activate = h("button", { cls: "mod-cta", text: "Activate" });
      const run = (text: string) => {
        error.textContent = "";
        activate.disabled = true;
        license
          .activate(text, post)
          .then(() => draw())
          .catch((e: unknown) => {
            error.textContent = e instanceof LicenseError ? e.message : "Activation failed.";
            activate.disabled = false;
          });
      };
      activate.addEventListener("click", () => run(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") run(input.value);
      });
      append(
        box,
        h("label", { attr: { for: id }, text: "License key (it is in your purchase email or receipt):" }),
        h("div", { cls: "bs-license-row" }, input, activate, h("button", { text: "Import file…", on: { click: () => pickLicenseFile(run) } })),
      );
    }
    append(box, error);
    if (license.configured) {
      append(box, h("div", { cls: "bs-license-row" }, h("button", { text: "Get Book Studio Pro", on: { click: () => host.openUrl(SALES_PAGE) } })));
    }
    if (PRO_PREVIEW) {
      const toggle = h("input", { attr: { type: "checkbox", checked: license.previewPro } });
      toggle.addEventListener("change", () => {
        license.previewPro = toggle.checked;
        draw();
      });
      append(box, h("label", { cls: "bs-check" }, toggle, "Try Pro without a key (developer builds only)"));
    }
    append(box, h("p", { cls: "bs-where", text: "Pro is a one-time payment and the key never expires. Activate sends the key once to the payment service to check it, and nothing else ever leaves your device: your notes and books stay here." }));
    container.appendChild(box);
  };
  draw();
}
