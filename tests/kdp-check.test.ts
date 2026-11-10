/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { buildBook, exportPdf } from "../src/app/pipeline";
import { trimById } from "../src/engine/trims";
import { checkKdpPdf } from "../tools/kdp-check";
import { testFonts } from "./helpers/fonts";
import { fsVault } from "./helpers/fsVault";

describe("KDP check of a print PDF", async () => {
  const fonts = await testFonts();
  const built = await buildBook(fsVault("sample/leyendas"), "Leyendas y rimas.md", fonts);
  const pdf = await exportPdf(built, fonts);
  const trim = trimById("6x9")!;

  it("passes the English sample too, with letter expansion and hanging punctuation", async () => {
    const oz = await buildBook(fsVault("sample/oz"), "The Wonderful Wizard of Oz.md", fonts);
    const ozPdf = await exportPdf(oz, fonts);
    const r = await checkKdpPdf(ozPdf.data, trim, { bleed: false, insideMarginPt: oz.layout.margins.inside });
    expect(r.errors).toEqual([]);
    expect(oz.layout.pages.some((p) => p.draws.some((d) => d.kind === "text" && d.scale !== undefined && d.scale !== 1))).toBe(true);
  });

  it("passes the Spanish sample as exported", async () => {
    const r = await checkKdpPdf(pdf.data, trim, { bleed: false, insideMarginPt: built.layout.margins.inside });
    expect(r.errors).toEqual([]);
    expect(r.pages).toBeGreaterThanOrEqual(24);
  });

  it("flags a page size that is not the trim, a missing bleed and a thin gutter", async () => {
    const wrongTrim = await checkKdpPdf(pdf.data, trimById("5x8")!, { bleed: false });
    expect(wrongTrim.errors.some((e) => e.includes("expected 5.000 in × 8.000 in"))).toBe(true);
    const wantedBleed = await checkKdpPdf(pdf.data, trim, { bleed: true });
    expect(wantedBleed.errors.some((e) => e.includes("6.125 in × 9.250 in"))).toBe(true);
    const thin = await checkKdpPdf(pdf.data, trim, { bleed: false, insideMarginPt: 18 });
    expect(thin.errors.some((e) => e.startsWith("Inside margin 0.250 in"))).toBe(true);
  });
}, 60_000);
