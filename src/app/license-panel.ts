// License controls for the web app's dialog. The Obsidian plugin shows the
// same choices in its settings tab with Obsidian's own controls.

import { ACTIVATE_URL, CHECKOUT_URL, PRO_PREVIEW } from "../config";
import { PRO_FEATURES } from "../engine/entitlements";
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

export function renderLicensePanel(container: HTMLElement, license: LicenseManager, host: Pick<StudioHost, "openUrl">): void {
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
      const input = h("input", { attr: { id, type: "text", autocomplete: "off", spellcheck: "false", placeholder: "BS1.…" } });
      const activate = h("button", { cls: "mod-cta", text: "Activate" });
      const run = (text: string) => {
        error.textContent = "";
        try {
          license.activate(text);
          draw();
        } catch (e) {
          error.textContent = e instanceof LicenseError ? e.message : "Activation failed.";
        }
      };
      activate.addEventListener("click", () => run(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") run(input.value);
      });
      append(
        box,
        h("label", { attr: { for: id }, text: "Have a license key? Paste it here, or import the .bslicense file:" }),
        h("div", { cls: "bs-license-row" }, input, activate, h("button", { text: "Import file…", on: { click: () => pickLicenseFile(run) } })),
      );
    }
    append(box, error);
    if (license.configured) {
      const buttons = h("div", { cls: "bs-license-row" });
      if (CHECKOUT_URL) append(buttons, h("button", { text: "Get Book Studio Pro", on: { click: () => host.openUrl(CHECKOUT_URL) } }));
      if (ACTIVATE_URL) append(buttons, h("button", { text: "I have bought it: get my key", on: { click: () => host.openUrl(ACTIVATE_URL) } }));
      append(box, CHECKOUT_URL ? buttons : h("p", { text: "Book Studio Pro isn't on sale yet." }));
    }
    if (PRO_PREVIEW) {
      const toggle = h("input", { attr: { type: "checkbox", checked: license.previewPro } });
      toggle.addEventListener("change", () => {
        license.previewPro = toggle.checked;
        draw();
      });
      append(box, h("label", { cls: "bs-check" }, toggle, "Try Pro without a key (developer builds only)"));
    }
    append(box, h("p", { cls: "bs-where", text: "A key is checked on your device, without the internet, and never expires. Book Studio makes no network requests, and your notes and books never leave your device." }));
    container.appendChild(box);
  };
  draw();
}
