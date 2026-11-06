/// <reference types="node" />
import { AxeBuilder } from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trimById } from "../src/engine/trims";
import { checkKdpPdf } from "../tools/kdp-check";
import { serve } from "./serve";

let browser: Browser;
let base: string;
let stop: () => void;

beforeAll(async () => {
  const { server, url } = await serve("dist/web");
  base = url;
  stop = () => server.close();
  // E2E_CHROMIUM points at a ready-made Chromium (the cloud image); CI installs Playwright's own.
  browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
});
afterAll(async () => {
  await browser?.close();
  stop?.();
});

async function openSample(page: Page): Promise<void> {
  await page.goto(`${base}?sample=leyendas`);
  await page.getByRole("button", { name: "Export print PDF" }).waitFor();
  // The preview is built once the first page appears.
  await page.locator(".bs-page, canvas, svg").first().waitFor({ timeout: 60_000 });
}

describe("web app, sample book", () => {
  it("exports a PDF that passes the KDP check", async () => {
    const page = await (await browser.newContext({ acceptDownloads: true, locale: "en-US" })).newPage();
    await openSample(page);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = new Uint8Array(await readFile((await download.path())));
    const r = await checkKdpPdf(bytes, trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    expect(r.pages).toBeGreaterThanOrEqual(24);
    await page.close();
  });

  it("exports an EPUB (a zip that starts with the mimetype entry)", async () => {
    const page = await (await browser.newContext({ acceptDownloads: true, locale: "en-US" })).newPage();
    await openSample(page);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export EPUB" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.epub$/);
    const bytes = await readFile((await download.path()));
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.subarray(30, 38).toString()).toBe("mimetype");
    await page.close();
  });

  it("shows the interface in Spanish for an es-ES browser and still exports the PDF", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "es-ES" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=leyendas`);
    await page.getByRole("button", { name: "Exportar PDF de impresión" }).waitFor();
    await page.locator(".bs-page, canvas, svg").first().waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Exportar EPUB" }).waitFor();
    expect(await page.getByRole("button", { name: "Export print PDF" }).count()).toBe(0);
    expect(await page.locator("html").getAttribute("lang")).toBe("es");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Exportar PDF de impresión" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = new Uint8Array(await readFile((await download.path())));
    const r = await checkKdpPdf(bytes, trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    // Switching back with the selector keeps the book open.
    await page.getByLabel("Idioma").selectOption("en");
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.locator(".bs-page, canvas, svg").first().waitFor({ timeout: 60_000 });
    expect(await page.getByRole("button", { name: "Exportar PDF de impresión" }).count()).toBe(0);
    await context.close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations on ${label}`, async () => {
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      await openSample(page);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
      await context.close();
    });
  }
});
