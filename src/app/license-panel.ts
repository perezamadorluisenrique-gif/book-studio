// License controls for the web app's dialog. The Obsidian plugin shows the
// same choices in its settings tab with Obsidian's own controls.

import { CHECKOUT_URL, PRO_PREVIEW } from "../config";
import { PRO_FEATURES } from "../engine/entitlements";
import { describeLicense, LicenseError } from "../engine/license";
import { append, clear, h } from "./dom";
import type { StudioHost } from "./host";
import type { LicenseManager } from "./license-manager";

export function renderLicensePanel(container: HTMLElement, license: LicenseManager, host: Pick<StudioHost, "openUrl">): void {
  const draw = () => {
    clear(container);
    const state = license.state;
    const box = h("div", { cls: "bs-license" });
    append(box, h("p", { text: license.previewPro ? "Pro preview is on. Exports include every Pro feature in this prototype build." : describeLicense(state) }));
    append(box, h("p", { text: "Book Studio Pro adds:" }), h("ul", null, ...Object.values(PRO_FEATURES).map((f) => h("li", { text: f }))));

    const error = h("p", { cls: "bs-error", attr: { role: "alert" } });
    if (!license.configured) {
      append(box, h("p", { text: "Licensing isn't configured in this build, so keys can't be activated here." }));
    } else if (state) {
      const remove = h("button", { text: "Remove key from this browser" });
      remove.addEventListener("click", () => {
        remove.disabled = true;
        void license.remove().then((note) => {
          draw();
          if (note) container.querySelector(".bs-error")?.replaceChildren(note);
        });
      });
      append(box, h("div", { cls: "bs-license-row" }, remove));
    } else {
      const id = `bs-key-${Math.random().toString(36).slice(2, 8)}`;
      const input = h("input", { attr: { id, type: "text", autocomplete: "off", spellcheck: "false" } });
      const activate = h("button", { cls: "mod-cta", text: "Activate" });
      const run = () => {
        activate.disabled = true;
        error.textContent = "";
        license.activate(input.value).then(
          () => draw(),
          (e: unknown) => {
            activate.disabled = false;
            error.textContent = e instanceof LicenseError ? e.message : "Activation failed.";
          },
        );
      };
      activate.addEventListener("click", run);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") run();
      });
      append(box, h("label", { attr: { for: id }, text: "Have a license key? Enter it here:" }), h("div", { cls: "bs-license-row" }, input, activate));
    }
    append(box, error);
    append(box, h("div", { cls: "bs-license-row" }, h("button", { text: "Get Book Studio Pro", on: { click: () => host.openUrl(CHECKOUT_URL) } })));
    if (PRO_PREVIEW) {
      const toggle = h("input", { attr: { type: "checkbox", checked: license.previewPro } });
      toggle.addEventListener("change", () => {
        license.previewPro = toggle.checked;
        draw();
      });
      append(box, h("label", { cls: "bs-check" }, toggle, "Try Pro without a key (prototype builds only)"));
    }
    append(box, h("p", { cls: "bs-where", text: "Checking a key sends it to Polar, the store that sells Book Studio Pro. Nothing else leaves your device: your notes and books never do." }));
    container.appendChild(box);
  };
  draw();
}
