import { describe, expect, it } from "vitest";
import { detectLocale, EN, ES, setLocale, t, tn } from "../src/app/ui-i18n";

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("ui-i18n", () => {
  it("has the same keys in English and Spanish", () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
  });

  it("has no empty text", () => {
    for (const [k, v] of Object.entries(EN)) expect(v.trim(), `en ${k}`).not.toBe("");
    for (const [k, v] of Object.entries(ES)) expect(v.trim(), `es ${k}`).not.toBe("");
  });

  it("uses the same {placeholders} in both languages", () => {
    for (const k of Object.keys(EN) as (keyof typeof EN)[]) expect(holes(ES[k]), k).toEqual(holes(EN[k]));
  });

  it("has both plural forms wherever one exists", () => {
    for (const k of Object.keys(EN)) {
      if (k.endsWith(".one")) expect(k.replace(/\.one$/, ".other") in EN, k).toBe(true);
    }
  });

  it("detects the language and fills in values", () => {
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("es")).toBe("es");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
    setLocale("es");
    expect(t("btn.pdf")).toBe("Exportar PDF de impresión");
    expect(tn("n.problem", 1)).toBe("1 problema");
    expect(tn("n.problem", 2)).toBe("2 problemas");
    setLocale("en");
    expect(t("btn.pdf")).toBe("Export print PDF");
    expect(tn("kdp.verdictWarn", 1)).toBe("No blocking problems. 1 thing to check before you upload.");
  });
});
