import { describe, expect, it } from "vitest";
import { FREE_ID, PAID_ID, bothOnNotice, inheritedSettings, isFirstRun, siblingOf } from "../src/obsidian/side-by-side";

describe("free and paid editions side by side", () => {
  it("pairs the two ids and nothing else", () => {
    expect(siblingOf(FREE_ID)).toBe(PAID_ID);
    expect(siblingOf(PAID_ID)).toBe(FREE_ID);
    expect(siblingOf("other")).toBeNull();
  });

  it("only the paid edition, on its first run, takes the free plugin's settings", () => {
    const free = { exportFolder: "Out", author: "Ana", data: { k: 1 } };
    expect(inheritedSettings(PAID_ID, null, free)).toEqual(free);
    expect(inheritedSettings(PAID_ID, {}, free)).toEqual(free);
    expect(inheritedSettings(PAID_ID, { author: "Me" }, free)).toBeNull();
    expect(inheritedSettings(FREE_ID, null, free)).toBeNull();
    expect(inheritedSettings(PAID_ID, null, [1])).toBeNull();
    expect(inheritedSettings(PAID_ID, null, {})).toBeNull();
    expect(isFirstRun(undefined)).toBe(true);
  });

  it("the paid edition says once that the free one can be turned off", () => {
    expect(bothOnNotice(PAID_ID, new Set([FREE_ID, PAID_ID]))).toMatch(/turn Book Studio off/);
    expect(bothOnNotice(PAID_ID, new Set([PAID_ID]))).toBeNull();
    expect(bothOnNotice(FREE_ID, new Set([FREE_ID, PAID_ID]))).toBeNull();
  });
});
