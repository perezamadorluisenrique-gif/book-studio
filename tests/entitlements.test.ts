import { describe, expect, it } from "vitest";
import { checkFreeBook, chooseFreeBook, epubBlockers, FREE_SWITCH_INTERVAL, printBlockers, themeAllowed, trimAllowed } from "../src/engine/entitlements";

describe("entitlements", () => {
  it("gives free users Classic and Modern at 6x9", () => {
    expect(themeAllowed("free", "classic")).toBe(true);
    expect(themeAllowed("free", "elegant")).toBe(false);
    expect(trimAllowed("free", "6x9")).toBe(true);
    expect(trimAllowed("free", "5x8")).toBe(false);
    expect(printBlockers("free", { theme: "modern", trim: "6x9" })).toEqual([]);
  });

  it("names every Pro feature a free export would need", () => {
    const b = printBlockers("free", { theme: "large-print", trim: "5x8" }, { boxSet: true });
    expect(b.map((x) => x.feature)).toEqual(["largePrint", "trim", "boxSets"]);
    expect(epubBlockers("free", { theme: "elegant" }).map((x) => x.feature)).toEqual(["theme"]);
    expect(printBlockers("pro", { theme: "large-print", trim: "5x8" }, { boxSet: true })).toEqual([]);
  });

  it("keeps free users to one book, switchable once a week", () => {
    const now = 1_000_000_000_000;
    expect(checkFreeBook("free", { path: null }, "A.md", now)).toEqual({ ok: true });
    const a = chooseFreeBook({ path: null }, "A.md", now);
    expect(checkFreeBook("free", a, "A.md", now)).toEqual({ ok: true });
    expect(checkFreeBook("free", a, "B.md", now + 1000)).toEqual({ ok: false, current: "A.md", canSwitch: false, switchAt: now + FREE_SWITCH_INTERVAL });
    expect(checkFreeBook("free", a, "B.md", now + FREE_SWITCH_INTERVAL)).toMatchObject({ ok: false, canSwitch: true });
    expect(checkFreeBook("pro", a, "B.md", now)).toEqual({ ok: true });
    expect(chooseFreeBook(a, "A.md", now + 5)).toBe(a);
  });
});
