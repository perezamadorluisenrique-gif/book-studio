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
    const page = await browser.newPage({ acceptDownloads: true });
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
    const page = await browser.newPage({ acceptDownloads: true });
    await openSample(page);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export EPUB" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.epub$/);
    const bytes = await readFile((await download.path()));
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.subarray(30, 38).toString()).toBe("mimetype");
    await page.close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations on ${label}`, async () => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await openSample(page);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
      await context.close();
    });
  }
});
