// The Pro tips of Book Studio: the rules (14 days, off for good), the places, their words and the publish window's choice.
import { describe, expect, it } from "vitest";
import { PRO_INCLUDED } from "../src/edition";
import { claimTip, hintHostFromStore, TIPS, turnOffTips, type HintHost, type TipPlace } from "../src/app/pro-tip";
import { EN, ES } from "../src/app/ui-i18n";
import { HINT_EVERY_MS, hintUrl, type HintSettings } from "../src/pro-hint";
import { createProject } from "../src/project/ops";
import { publishTipPlace } from "../src/web/publish";

function memoryHost(start: Partial<HintSettings> = {}): HintHost & { saved: number } {
  let s: HintSettings = { proHints: true, proHintShown: {}, ...start };
  const host = {
    saved: 0,
    get: () => s,
    set: (next: HintSettings) => {
      s = next;
      host.saved++;
    },
  };
  return host;
}

describe("tip words and places", () => {
  it("every place has a line in English and Spanish that names Book Studio Pro and no price", () => {
    for (const [place, key] of Object.entries(TIPS)) {
      for (const text of [EN[key], ES[key]]) {
        expect(text, place).toContain("Book Studio Pro");
        expect(text, place).not.toMatch(/\$|€|USD/);
      }
      expect(hintUrl("book-studio", place)).toBe(`https://perezamadorluisenrique-gif.github.io/pro/book-studio/?ref=${place}`);
    }
    expect(EN["tip.more"] && EN["tip.off"] && ES["tip.more"] && ES["tip.off"]).toBeTruthy();
  });

  it("never advertises what the free edition already has", () => {
    const all = Object.values(TIPS).map((k) => EN[k]).join(" ");
    expect(all).not.toMatch(/trim|preflight|full cover/i);
  });
});

describe.runIf(!PRO_INCLUDED)("claimTip in the free edition", () => {
  it("shows a place once, then stays quiet for 14 days", () => {
    const host = memoryHost();
    const t0 = 1_000_000_000_000;
    expect(claimTip(host, "bs-theme", t0)).toBe(true);
    expect(host.get().proHintShown["bs-theme"]).toBe(t0);
    expect(claimTip(host, "bs-theme", t0 + HINT_EVERY_MS - 1)).toBe(false);
    expect(claimTip(host, "bs-theme", t0 + HINT_EVERY_MS)).toBe(true);
  });

  it("keeps each place on its own clock", () => {
    const host = memoryHost();
    expect(claimTip(host, "bs-theme", 5e12)).toBe(true);
    expect(claimTip(host, "bs-hardcover", 5e12)).toBe(true);
  });

  it("shows nothing without a host or after \"Don't show again\"", () => {
    expect(claimTip(undefined, "bs-theme")).toBe(false);
    const host = memoryHost();
    turnOffTips(host);
    expect(host.get().proHints).toBe(false);
    expect(claimTip(host, "bs-theme")).toBe(false);
    expect(claimTip(host, "bsweb-store")).toBe(false);
  });
});

describe("hintHostFromStore (the web app)", () => {
  const store = () => {
    const data: Record<string, unknown> = {};
    return { data, get: <T>(k: string) => data[k] as T | undefined, set: (k: string, v: unknown) => void (v === undefined ? delete data[k] : (data[k] = v)) };
  };

  it("starts on, saves dates and the off switch, and survives junk", () => {
    const s = store();
    const host = hintHostFromStore(s);
    expect(host.get()).toEqual({ proHints: true, proHintShown: {} });
    host.set({ proHints: false, proHintShown: { "bs-theme": 5 } });
    expect(hintHostFromStore(s).get()).toEqual({ proHints: false, proHintShown: { "bs-theme": 5 } });
    s.data.proHintShown = "garbage";
    s.data.proHints = 3;
    expect(hintHostFromStore(s).get()).toEqual({ proHints: true, proHintShown: {} });
  });
});

describe("publishTipPlace (web publish window)", () => {
  const book = () => createProject({ id: "p", name: "Faro", now: 1 });
  const asked: TipPlace[] = [];
  const always = (p: TipPlace) => (asked.push(p), true);

  it("offers the per-store EPUB to any book", () => {
    expect(publishTipPlace(book(), false, () => true)).toBe("bsweb-store");
  });

  it("offers the sales kit to a book that is ready, and hardcover editions to a hardcover", () => {
    expect(publishTipPlace(book(), true, () => true)).toBe("bsweb-kit");
    const hard = { ...book(), settings: { ...book().settings, binding: "hardcover" } };
    expect(publishTipPlace(hard, true, () => true)).toBe("bsweb-hardcover");
  });

  it("falls to the next place when one is not due, and gives nothing when none is", () => {
    expect(publishTipPlace(book(), true, (p) => p !== "bsweb-kit")).toBe("bsweb-store");
    expect(publishTipPlace(book(), true, () => false)).toBeNull();
  });

  it("stops asking at the first place that is due (so only one is marked as shown)", () => {
    asked.length = 0;
    publishTipPlace(book(), true, always);
    expect(asked).toEqual(["bsweb-kit"]);
  });
});
