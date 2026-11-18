// The Pro tip: one fixed line inside the studio's own screens (the settings bar, the web publish window) that
// says what Book Studio Pro adds, right where the person is doing the thing it extends. It is fixed text bundled
// with the app: no network, no counting. The only thing kept is when each place last showed its tip, in the
// host's own storage. The rules (at most once every 14 days per place, "Don't show again", one switch) are the
// shared ones in ../pro-hint.ts; this file draws the line with `h`, so it works in Obsidian and in the browser.

import { FREE_EDITION } from "../config";
import { cleanHintSettings, hintDue, hintsOff, hintUrl, markHintShown, type HintSettings } from "../pro-hint";
import { h } from "./dom";
import { t } from "./ui-i18n";

/** Where a host keeps the tip settings: Obsidian in data.json, the web app in its own store. */
export interface HintHost {
  get(): HintSettings;
  set(next: HintSettings): void;
}

/** The public page of Book Studio Pro. */
export const PRO_PAGE = "book-studio";

/** Every place a tip can show, with the words (translation key) of its line. */
export const TIPS = {
  "bs-hardcover": "tip.hardcover",
  "bs-theme": "tip.theme",
  "bsweb-hardcover": "tip.pub.hardcover",
  "bsweb-kit": "tip.pub.kit",
  "bsweb-store": "tip.pub.store",
} as const;
export type TipPlace = keyof typeof TIPS;

/** A host that keeps the settings in a plain key-value store (the web app; the Obsidian plugin uses its own data). */
export function hintHostFromStore(store: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void }): HintHost {
  return {
    get: () => cleanHintSettings({ proHints: store.get("proHints"), proHintShown: store.get("proHintShown") }),
    set: (s) => {
      store.set("proHints", s.proHints);
      store.set("proHintShown", s.proHintShown);
    },
  };
}

/** True while some tip is on the page: there is never more than one. */
export function tipOnScreen(root: ParentNode = document): boolean {
  return root.querySelector(".siulved-pro-hint") !== null;
}

/**
 * Decides whether `place` shows its tip now. When it does, the time is saved (so the next 14 days are quiet) and
 * true is returned. Free edition only: the full edition has nothing to point to.
 */
export function claimTip(hints: HintHost | undefined, place: TipPlace, now: number = Date.now()): boolean {
  if (!FREE_EDITION || !hints) return false;
  const s = hints.get();
  if (!hintDue(s, place, now)) return false;
  hints.set(markHintShown(s, place, now));
  return true;
}

/** "Don't show again": every tip stays off from now on. */
export function turnOffTips(hints: HintHost): void {
  hints.set(hintsOff(hints.get()));
}

/** Draws the claimed tip as the last child of `parent`; "Don't show again" removes it and calls `onOff`. */
export function drawTip(parent: HTMLElement, hints: HintHost, place: TipPlace, open: (url: string) => void, onOff: () => void = () => {}): HTMLElement {
  const box = h(
    "div",
    { cls: "siulved-pro-hint", attr: { role: "note", "data-place": place } },
    h("span", { cls: "siulved-pro-hint-text", text: t(TIPS[place]) }),
    h(
      "div",
      { cls: "siulved-pro-hint-actions" },
      h("button", { cls: "siulved-pro-hint-more", text: t("tip.more"), attr: { type: "button" }, on: { click: () => open(hintUrl(PRO_PAGE, place)) } }),
      h("button", {
        cls: "siulved-pro-hint-off",
        text: t("tip.off"),
        attr: { type: "button" },
        on: {
          click: () => {
            turnOffTips(hints);
            box.remove();
            onOff();
          },
        },
      }),
    ),
  );
  parent.appendChild(box);
  return box;
}
