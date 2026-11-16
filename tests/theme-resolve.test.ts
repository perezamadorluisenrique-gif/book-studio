import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/engine/model";
import { settingsFromFrontmatter } from "../src/engine/manifest";
import { resolveTheme, themeById } from "../src/engine/themes";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

describe("resolveTheme is the one place a style is decided", () => {
  it("nobody outside themes.ts looks a style up by id", () => {
    const call = "themeById" + "(";
    const offenders = [...walk("src"), ...walk("tests"), ...walk("tools")].filter((f) => !f.endsWith("themes.ts") && !f.endsWith("theme-resolve.test.ts") && readFileSync(f, "utf8").includes(call));
    expect(offenders).toEqual([]);
  });

  it("without changes it returns the style as designed", () => {
    for (const id of ["classic", "modern", "elegant", "nonfiction", "large-print"]) {
      const base = themeById(id);
      const t = resolveTheme({ ...DEFAULT_SETTINGS, theme: id });
      expect(t.body).toEqual(base.body);
      expect(t.margins).toEqual(base.margins);
      expect(t.firstParagraph).toEqual(base.firstParagraph);
      expect(t.sceneBreak).toEqual(base.sceneBreak);
    }
  });

  it("keeps reading the two older settings", () => {
    const t = resolveTheme({ ...DEFAULT_SETTINGS, fontSize: 12, sceneBreak: "~" });
    expect(t.body.size).toBe(12);
    expect(t.body.leading).toBeCloseTo((15 * 12) / 11.5, 6);
    expect(t.sceneBreak).toMatchObject({ glyph: "~" });
  });

  it("limits the size, the leading and the margins inside the function", () => {
    const s = (style: object, extra: object = {}) => resolveTheme({ ...DEFAULT_SETTINGS, ...extra, style });
    expect(s({ size: 30 }).body.size).toBe(14);
    expect(s({ size: 2 }).body.size).toBe(9);
    expect(s({ size: 30 }, { theme: "large-print" }).body.size).toBe(20);
    expect(s({ size: 10, leading: 0.5 }).body.leading).toBe(12);
    expect(s({ size: 10, leading: 1.37 }).body.leading).toBe(13.75);
    expect(s({ margins: { outside: 0.05 } }).margins.outside).toBe(0.25);
    expect(resolveTheme({ ...DEFAULT_SETTINGS, bleed: true, style: { margins: { top: 0.1 } } }).margins.top).toBe(0.375);
    expect(s({ dropCap: 0 }).firstParagraph.dropCap).toBe(0);
    expect(s({ indent: 9 }).body.indent).toBe(3);
  });

  it("reads the style from flat front matter keys", () => {
    const s = settingsFromFrontmatter({ "style-size": 12, "style-leading": "1,4", "style-margin-inside": 0.9, "style-drop-cap": 2 });
    expect(s.style).toEqual({ size: 12, leading: 1.4, margins: { inside: 0.9 }, dropCap: 2 });
    expect(settingsFromFrontmatter({}).style).toBeUndefined();
  });
});

import { setStyleField } from "../src/engine/style-ops";

describe("style operations", () => {
  it("sets and clears one field at a time", () => {
    let s = setStyleField(undefined, "size", 12);
    s = setStyleField(s, "inside", 0.9);
    s = setStyleField(s, "dropCap", 2);
    expect(s).toEqual({ size: 12, margins: { inside: 0.9 }, dropCap: 2 });
    s = setStyleField(s, "inside", undefined);
    expect(s).toEqual({ size: 12, dropCap: 2 });
    expect(setStyleField(setStyleField(s, "size", undefined), "dropCap", undefined)).toBeUndefined();
  });
});
