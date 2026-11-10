/// <reference types="node" />
import { AxeBuilder } from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import JSZip from "jszip";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("sets the pages in a worker, and still shows the book when the worker can't start", async () => {
    const page = await (await browser.newContext({ locale: "en-US" })).newPage();
    await openSample(page);
    expect(page.workers().some((w) => w.url().endsWith("/layout-worker.js"))).toBe(true);
    await page.close();

    const blocked = await (await browser.newContext({ locale: "en-US", serviceWorkers: "block" })).newPage();
    await blocked.route("**/layout-worker.js", (route) => route.abort());
    await openSample(blocked);
    expect(await blocked.locator(".bs-page, canvas, svg").count()).toBeGreaterThan(0);
    expect(blocked.workers().some((w) => w.url().endsWith("/layout-worker.js"))).toBe(false);
    await blocked.close();
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

describe("web app, my books", () => {
  async function createFromTemplate(page: Page, name: string): Promise<void> {
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Book name").fill(name);
    await page.getByLabel("The Starter Book template").check();
    await page.getByRole("button", { name: "Create book" }).click();
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.locator(".bs-page, canvas, svg").first().waitFor({ timeout: 60_000 });
  }

  it("creates a book from the template, keeps it after a reload and exports a PDF that passes the KDP check", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await createFromTemplate(page, "My first novel");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const bytes = new Uint8Array(await readFile((await download.path())));
    const r = await checkKdpPdf(bytes, trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    expect(r.pages).toBeGreaterThan(0);

    // After a reload the page opens on the list of books, and the book is still there.
    await page.goto(base);
    await page.getByRole("heading", { name: "My books" }).waitFor();
    await page.getByRole("button", { name: "Open My first novel" }).waitFor();
    expect(await page.getByText("5 chapters").count()).toBe(1);
    await page.getByRole("button", { name: "Open My first novel" }).click();
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.locator(".bs-page, canvas, svg").first().waitFor({ timeout: 60_000 });
    await context.close();
  });

  it("renames and deletes a book (with a confirmation), and creates a blank one", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Book name").fill("Blank one");
    await page.getByRole("button", { name: "Create book" }).click();
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByRole("button", { name: "Rename Blank one" }).click();
    await page.getByLabel("New name").fill("Renamed one");
    await page.getByRole("button", { name: "Save name" }).click();
    await page.getByRole("button", { name: "Open Renamed one" }).waitFor();
    await page.getByRole("button", { name: "Delete Renamed one" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await page.getByRole("button", { name: "Open Renamed one" }).count()).toBe(1);
    await page.getByRole("button", { name: "Delete Renamed one" }).click();
    await page.getByRole("button", { name: "Delete book" }).click();
    await page.getByText("You have no books yet").waitFor();
    await context.close();
  });

  it("shows the screen in Spanish for an es-ES browser", async () => {
    const context = await browser.newContext({ locale: "es-ES" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Exportar PDF de impresión" }).waitFor();
    await page.getByRole("button", { name: "Mis libros" }).click();
    await page.getByRole("button", { name: "Crear libro" }).waitFor();
    await page.getByLabel("La plantilla Starter Book").waitFor();
    await context.close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations on the books screen, ${label}`, async () => {
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      await page.goto(`${base}?sample=oz`);
      await page.getByRole("button", { name: "Export print PDF" }).waitFor();
      await page.getByRole("button", { name: "My books" }).click();
      await page.getByLabel("Book name").fill("Axe book");
      await page.getByLabel("The Starter Book template").check();
      await page.getByRole("button", { name: "Create book" }).click();
      // On a phone the book opens on the editor; the export buttons are on the "Book" tab.
      await page.locator("#ed-text").waitFor();
      await page.getByRole("button", { name: "My books" }).click();
      await page.getByRole("button", { name: "Open Axe book" }).waitFor();
      // Check the list and also the rename form.
      await page.getByRole("button", { name: "Rename Axe book" }).click();
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
      await context.close();
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    it(`keeps the text of the studio's buttons and menus readable in ${scheme} mode`, async () => {
      const context = await browser.newContext({ colorScheme: scheme, locale: "en-US", viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(`${base}?sample=oz`);
      await page.getByRole("button", { name: "Export print PDF" }).waitFor();
      // Contrast of each control's text against the color it is drawn on (WCAG ratio; 4.5 is the AA floor for text).
      const faint = await page.evaluate(() => {
        const lum = (rgb: string) => {
          const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratios: [string, number][] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".bs-studio button, .bs-studio select"))) {
          if (!el.offsetParent) continue;
          const s = getComputedStyle(el);
          // Transparent controls (the tabs) sit on whatever the nearest opaque ancestor paints.
          let bgEl: HTMLElement | null = el;
          while (bgEl && /rgba\(.*, 0\)|transparent/.test(getComputedStyle(bgEl).backgroundColor)) bgEl = bgEl.parentElement;
          const a = lum(s.color), b = lum(bgEl ? getComputedStyle(bgEl).backgroundColor : "rgb(255, 255, 255)");
          ratios.push([(el.textContent ?? "").trim().slice(0, 30), (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)]);
        }
        return ratios.filter(([, r]) => r < 4.5);
      });
      expect(faint, "controls with text too faint for their background").toEqual([]);
      await context.close();
    });
  }
});

describe("web app, writing", () => {
  /** Open the app on the sample, then start a book (blank or from the template) and wait for the editor and the preview. */
  async function startBook(page: Page, name: string, template = false): Promise<void> {
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Book name").fill(name);
    if (template) await page.getByLabel("The Starter Book template").check();
    await page.getByRole("button", { name: "Create book" }).click();
    await page.locator("#ed-text").waitFor();
    // On a phone the preview is on another tab and is not painted until you open it.
    if ((page.viewportSize()?.width ?? 1280) > 900) await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
  }

  const saved = (page: Page) => page.locator(".ed-status", { hasText: "Saved" }).waitFor();
  const chapterNames = (page: Page) => page.locator(".ch-pick").allTextContents();
  const tocOrder = async (page: Page) => (await page.getByLabel("Go to a chapter").locator("option").allTextContents()).slice(1).map((o) => o.replace(/ · .*$/, "").replace(/^\d+\. /, ""));
  /** What the painted pages look like now, by page number (the preview is drawn on canvases, so pixels are all there is to compare). */
  const pixels = (page: Page) =>
    page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>(".bs-page.is-painted")).map((f) => [f.dataset.index ?? "", f.querySelector("canvas")?.toDataURL() ?? ""])));

  it("keeps what you write after a reload, shows it in the preview within 3 s and exports a valid PDF", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Writing test");
    const before = await pixels(page);
    const phrase = "The quick brown fox jumps over the lazy dog.";
    await page.locator("#ed-text").fill(`${phrase}\n\nA second paragraph, so the page has something to show.`);
    await vi.waitFor(
      async () => {
        const now = await pixels(page);
        expect(Object.keys(now).some((i) => i in before && now[i] !== "" && now[i] !== before[i])).toBe(true);
      },
      { timeout: 3000, interval: 100 },
    );
    await saved(page);
    expect(await page.locator(".ed-words").textContent()).toBe("19 words");

    await page.goto(base);
    await page.getByRole("button", { name: "Open Writing test" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await page.locator("#ed-text").inputValue()).toContain(phrase);

    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const bytes = new Uint8Array(await readFile(await download.path()));
    const r = await checkKdpPdf(bytes, trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    await context.close();
  });

  it("formats with the toolbar and with Ctrl+B / Ctrl+I", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Format test");
    const box = page.locator("#ed-text");
    await box.fill("hello");
    await box.press("Control+a");
    await box.press("Control+b");
    expect(await box.inputValue()).toBe("**hello**");
    await box.press("Control+b");
    await box.press("Control+i");
    expect(await box.inputValue()).toBe("*hello*");
    await page.getByRole("button", { name: "Bold (Ctrl+B)" }).click();
    expect(await box.inputValue()).toBe("***hello***");
    await box.press("Control+Home");
    await page.getByRole("button", { name: "Section title" }).click();
    expect(await box.inputValue()).toMatch(/^## /);
    await box.press("Control+End");
    await page.getByRole("button", { name: "Scene break" }).click();
    expect(await box.inputValue()).toMatch(/\n\n\* \* \*$/);
    for (const name of ["Footnote", "Quote", "Italic (Ctrl+I)"]) expect(await page.getByRole("button", { name }).count()).toBe(1);
    await context.close();
  });

  it("changes the order of the book with Alt+Up and Alt+Down, and keeps it after a reload", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Order test", true);
    expect(await chapterNames(page)).toEqual(["Dedication", "Chapter One", "Chapter Two", "Chapter Three", "About the author"]);
    expect((await tocOrder(page)).filter((n) => n.startsWith("Chapter")).slice(0, 3)).toEqual(["Chapter One", "Chapter Two", "Chapter Three"]);
    const two = page.getByRole("button", { name: "Chapter Two", exact: true });
    await two.focus();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await chapterNames(page)).toEqual(["Dedication", "Chapter Two", "Chapter One", "Chapter Three", "About the author"]);
    // The focus stays on the chapter that moved.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Chapter Two");
    await vi.waitFor(async () => expect((await tocOrder(page)).filter((n) => n.startsWith("Chapter")).slice(0, 3)).toEqual(["Chapter Two", "Chapter One", "Chapter Three"]), { timeout: 10_000, interval: 200 });
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Alt+ArrowDown");
    expect(await chapterNames(page)).toEqual(["Dedication", "Chapter One", "Chapter Three", "Chapter Two", "About the author"]);
    // The buttons do the same, and the announcement says where the chapter went.
    await page.getByRole("button", { name: "Move Chapter Three up" }).click();
    expect(await chapterNames(page)).toEqual(["Dedication", "Chapter Three", "Chapter One", "Chapter Two", "About the author"]);
    await vi.waitFor(async () => expect(await page.locator(".ws-list [role=status]").textContent()).toContain("Moved “Chapter Three” to Chapters, place 1 of 3."), { timeout: 3000 });
    await saved(page);
    await page.goto(base);
    await page.getByRole("button", { name: "Open Order test" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await chapterNames(page)).toEqual(["Dedication", "Chapter Three", "Chapter One", "Chapter Two", "About the author"]);
    await context.close();
  });

  it("adds, renames and deletes chapters (with a confirmation)", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Chapters test");
    expect(await page.getByRole("button", { name: "Delete Chapter One" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Add a chapter to Chapters" }).click();
    const rename = page.getByLabel("Chapter title");
    await rename.fill("Afterword");
    await rename.press("Enter");
    expect(await chapterNames(page)).toEqual(["Chapter One", "Afterword"]);
    expect(await page.locator(".ed-heading").textContent()).toBe("Writing: Afterword");
    await page.locator("#ed-text").fill("Thanks for reading.");
    await page.getByRole("button", { name: "Rename Afterword" }).click();
    await page.getByLabel("Chapter title").fill("Thanks");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await chapterNames(page)).toEqual(["Chapter One", "Thanks"]);
    await vi.waitFor(async () => expect(await tocOrder(page)).toEqual(["Chapter One", "Thanks"]), { timeout: 10_000, interval: 200 });
    await page.getByRole("button", { name: "Delete Thanks" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await chapterNames(page)).toEqual(["Chapter One", "Thanks"]);
    await page.getByRole("button", { name: "Delete Thanks" }).click();
    await page.getByRole("button", { name: "Delete chapter", exact: true }).click();
    await vi.waitFor(async () => expect(await chapterNames(page)).toEqual(["Chapter One"]), { timeout: 5000, interval: 100 });
    expect(await page.locator(".ed-heading").textContent()).toBe("Writing: Chapter One");
    await saved(page);
    await page.goto(base);
    await page.getByRole("button", { name: "Open Chapters test" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await chapterNames(page)).toEqual(["Chapter One"]);
    await context.close();
  });

  it("opens the chapter at the right line from the Problems tab", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Problems test");
    const lines = ["First line.", "", "Third line.", "", "<div>raw html</div>", "", "Last line."];
    await page.locator("#ed-text").fill(lines.join("\n"));
    await page.getByRole("tab", { name: /^Problems/ }).click();
    const item = page.locator(".bs-panel-problems li", { hasText: "Raw HTML block" });
    await item.waitFor({ timeout: 10_000 });
    // A problem in the book's own note opens the book details form.
    await page.locator(".bs-panel-problems li", { hasText: "No author" }).locator(".bs-link").click();
    await page.getByRole("heading", { name: "Book details" }).waitFor();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("dt-heading");
    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await item.locator(".bs-link").click();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("ed-text");
    const caret = await page.locator("#ed-text").evaluate((el: HTMLTextAreaElement) => el.value.slice(0, el.selectionStart).split("\n").length);
    expect(caret).toBe(5);
    await context.close();
  });

  it("shows the editor in Spanish for an es-ES browser", async () => {
    const context = await browser.newContext({ locale: "es-ES" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Exportar PDF de impresión" }).waitFor();
    await page.getByRole("button", { name: "Mis libros" }).click();
    await page.getByLabel("Nombre del libro").fill("Libro de prueba");
    await page.getByLabel("La plantilla Starter Book").check();
    await page.getByRole("button", { name: "Crear libro" }).click();
    await page.locator("#ed-text").waitFor();
    for (const name of ["Negrita (Ctrl+B)", "Cursiva (Ctrl+I)", "Título de sección", "Separador de escena", "Nota al pie", "Cita"]) expect(await page.getByRole("button", { name }).count()).toBe(1);
    expect(await page.getByRole("heading", { name: "Preliminares" }).count()).toBe(1);
    expect(await page.getByRole("heading", { name: "Parte final" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Añadir un capítulo a Capítulos" }).count()).toBe(1);
    await page.locator("#ed-text").fill("Hola mundo");
    await page.locator(".ed-status", { hasText: "Guardado" }).waitFor();
    expect(await page.locator(".ed-words").textContent()).toBe("2 palabras");
    await context.close();
  });

  it("has three columns on a wide screen and three tabs on a phone", async () => {
    const wide = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" })).newPage();
    await startBook(wide, "Layout test", true);
    const boxes = await Promise.all(["#ws-panel-chapters", "#ws-panel-write", "#ws-panel-book"].map((s) => wide.locator(s).boundingBox()));
    expect(boxes.every((b) => b && b.width > 150)).toBe(true);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    expect(await wide.getByRole("tab", { name: "Write" }).count()).toBe(0);
    await wide.context().close();

    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" })).newPage();
    await startBook(phone, "Layout test", true);
    expect(await phone.locator("#ed-text").isVisible()).toBe(true);
    expect(await phone.getByRole("button", { name: "Chapter Two", exact: true }).isVisible()).toBe(false);
    await phone.getByRole("tab", { name: "Chapters" }).click();
    expect(await phone.locator("#ed-text").isVisible()).toBe(false);
    await phone.getByRole("button", { name: "Chapter Two", exact: true }).click();
    // Picking a chapter goes straight to the editor.
    expect(await phone.getByRole("tab", { name: "Write" }).getAttribute("aria-selected")).toBe("true");
    expect(await phone.locator(".ed-heading").textContent()).toBe("Writing: Chapter Two");
    await phone.getByRole("tab", { name: "Book" }).click();
    await phone.getByRole("button", { name: "Export print PDF" }).waitFor();
    expect(await phone.locator("#ed-text").isVisible()).toBe(false);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await phone.context().close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations with the editor open, ${label}`, async () => {
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      await startBook(page, "Axe writing", true);
      const serious = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length} node(s)`);
      await page.locator("#ed-text").fill("Some words to check.");
      expect(await serious()).toEqual([]);
      if (label !== "desktop") {
        await page.getByRole("tab", { name: "Chapters" }).click();
        expect(await serious()).toEqual([]);
      }
      // The list with a rename form open.
      await page.getByRole("button", { name: "Rename Chapter One" }).click();
      expect(await serious()).toEqual([]);
      if (label !== "desktop") {
        await page.getByRole("tab", { name: "Book" }).click();
        expect(await serious()).toEqual([]);
      }
      await context.close();
    });
  }
});

/** A plain-colour PNG of this size (a real, valid file, small once compressed). */
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3, 0x7a);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Run W3C EPUBCheck on a file, with warnings counting as failures. Returns null when Java or the jar is missing. */
async function epubcheck(file: string): Promise<{ ok: boolean; log: string } | null> {
  const jar = process.env.EPUBCHECK_JAR || "out/epubcheck-5.2.1/epubcheck.jar";
  if (!existsSync(jar)) return null;
  return new Promise((resolve) => {
    execFile("java", ["-jar", jar, "--failonwarnings", file], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err && (err as { code?: string }).code === "ENOENT") resolve(null);
      else resolve({ ok: !err, log: `${stdout}\n${stderr}` });
    });
  });
}

describe("web app, book details and cover", () => {
  async function startBook(page: Page, name: string): Promise<void> {
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Book name").fill(name);
    await page.getByRole("button", { name: "Create book" }).click();
    await page.locator("#ed-text").waitFor();
    if ((page.viewportSize()?.width ?? 1280) > 900) await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
  }
  const openDetails = async (page: Page) => {
    await page.getByRole("button", { name: "Edit the book's details and cover" }).click();
    await page.getByRole("heading", { name: "Book details" }).waitFor();
  };
  // The "Saved" note belongs to the chapter editor, which is hidden while the form is open.
  const saved = (page: Page) => page.locator(".ed-status", { hasText: "Saved" }).waitFor({ state: "attached" });
  const field = (page: Page, label: string) => page.locator(".dt").getByLabel(label, { exact: true });

  const DATA: Record<string, string> = {
    Title: "El faro: una historia",
    Subtitle: "Novela de mar",
    "Author": "Ana María",
    Publisher: "Ediciones Faro",
    "ISBN of the paperback": "978-84-376-0494-7",
    "ISBN of the ebook": "9780306406157",
    "Copyright line": "© 2026 Ana María. Todos los derechos reservados.",
    Dedication: "Para quien lo leyó primero.",
    Epigraph: "Mar adentro.",
    Description: "Una historia de faros.",
    Keywords: "mar, faro, novela",
    Series: "Costa Norte",
  };

  it("keeps the details after a reload, checks the ISBN and the keywords, and exports a PDF that passes the KDP check", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Details test");
    await openDetails(page);
    for (const [label, value] of Object.entries(DATA)) await field(page, label).fill(value);
    await field(page, "Language").selectOption("es");

    // A wrong ISBN is flagged for screen readers and the message is linked to the field.
    const isbn = field(page, "ISBN of the paperback");
    await isbn.fill("9780306406158");
    expect(await isbn.getAttribute("aria-invalid")).toBe("true");
    expect(await isbn.getAttribute("aria-describedby")).toContain("dt-isbnPrint-err");
    expect(await page.locator("#dt-isbnPrint-err").textContent()).toContain("last digit");
    await isbn.fill(DATA["ISBN of the paperback"]);
    expect(await isbn.getAttribute("aria-invalid")).toBeNull();
    expect(await page.locator("#dt-isbnPrint-err").textContent()).toBe("");

    // More than seven keywords: only seven are kept, and the field says so.
    const keywords = field(page, "Keywords");
    await keywords.fill("a, b, c, d, e, f, g, h");
    expect(await keywords.getAttribute("aria-invalid")).toBe("true");
    expect(await page.locator("#dt-keywords-err").textContent()).toContain("only the first 7");
    await keywords.fill(DATA.Keywords);

    // Genre themes show as disabled with the Pro label; Elegant, every trim and the other free themes are allowed.
    const thriller = page.locator("#dt-theme option[value=thriller]");
    expect(await thriller.isDisabled()).toBe(true);
    expect(await thriller.textContent()).toContain("Pro");
    for (const free of ["modern", "elegant", "nonfiction", "large-print"]) expect(await page.locator(`#dt-theme option[value=${free}]`).isDisabled(), free).toBe(false);
    expect(await page.locator("#dt-trim option[value=\"7x10\"]").isDisabled()).toBe(false);
    await field(page, "Trim size").selectOption("5x8");
    await saved(page);

    await page.goto(base);
    await page.getByRole("button", { name: "Open Details test" }).click();
    await page.locator("#ed-text").waitFor();
    await openDetails(page);
    for (const [label, value] of Object.entries(DATA)) expect(await field(page, label).inputValue(), label).toBe(value);
    expect(await field(page, "Language").inputValue()).toBe("es");
    expect(await field(page, "Trim size").inputValue()).toBe("5x8");

    // The preview uses the details, and the PDF passes the KDP check at the chosen trim.
    await page.locator(".bs-status", { hasText: "El faro: una historia" }).waitFor({ timeout: 60_000 });
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const bytes = new Uint8Array(await readFile(await download.path()));
    const r = await checkKdpPdf(bytes, trimById("5x8")!, { bleed: false });
    expect(r.errors).toEqual([]);
    await context.close();
  });

  it("uploads a cover, exports an EPUB that has it as the cover image, and EPUBCheck passes", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await startBook(page, "Cover test");
    await openDetails(page);
    await field(page, "Author").fill("Ana María");

    // Wrong files are refused with a message.
    await page.locator("#dt-cover-file").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not a picture") });
    await page.getByText("not a JPG or PNG").waitFor();
    await page.locator("#dt-cover-file").setInputFiles({ name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(11 * 1024 * 1024, 0xff) });
    await page.getByText("the limit is 10 MB").waitFor();

    const png = makePng(600, 900);
    await page.locator("#dt-cover-file").setInputFiles({ name: "my cover.png", mimeType: "image/png", buffer: png });
    const thumb = page.getByRole("img", { name: "Cover of Cover test" });
    await thumb.waitFor();
    // Too small for print: the warning says which size is needed (6 x 9 with bleed at 300 ppi).
    await page.getByText("smaller than the 1838 × 2775").waitFor();
    expect(await page.getByText("needs at least 1838 × 2775 pixels").count()).toBe(1);
    await saved(page);

    await page.goto(base);
    await page.getByRole("button", { name: "Open Cover test" }).click();
    await page.locator("#ed-text").waitFor();
    await openDetails(page);
    await page.getByRole("img", { name: "Cover of Cover test" }).waitFor();

    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export EPUB" }).click()]);
    const epub = await readFile(await download.path());
    const zip = await JSZip.loadAsync(epub);
    const opf = await zip.file(/\.opf$/)[0].async("string");
    const item = /<item [^>]*properties="cover-image"[^>]*>/.exec(opf)?.[0];
    expect(item, "an item with properties=cover-image").toBeTruthy();
    expect(item).toContain('media-type="image/png"');
    const href = /href="([^"]+)"/.exec(item!)![1];
    const opfDir = zip.file(/\.opf$/)[0].name.replace(/[^/]*$/, "");
    const inZip = zip.file(opfDir + href);
    expect(inZip, "the cover file in the zip").toBeTruthy();
    expect(Buffer.from(await inZip!.async("uint8array")).equals(png)).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), "bs-epub-"));
    const file = join(dir, download.suggestedFilename());
    await writeFile(file, epub);
    const check = await epubcheck(file);
    if (!check) console.warn("EPUBCheck did NOT run: Java or out/epubcheck-5.2.1/epubcheck.jar is missing (npm run epubcheck downloads it).");
    else expect(check.ok, check.log).toBe(true);

    // Removing the cover takes it out of the next EPUB.
    await openDetails(page);
    await page.getByRole("button", { name: "Remove the cover image" }).click();
    await page.getByText("No cover image yet.").waitFor();
    await saved(page);
    await context.close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations with the details form open, ${label}`, async () => {
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      await startBook(page, "Axe details");
      if (label !== "desktop") await page.getByRole("tab", { name: "Chapters" }).click();
      await openDetails(page);
      await field(page, "ISBN of the paperback").fill("123");
      await page.locator("#dt-cover-file").setInputFiles({ name: "c.png", mimeType: "image/png", buffer: makePng(100, 150) });
      await page.getByRole("img", { name: "Cover of Axe details" }).waitFor();
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
      // Every control is at least 24 px tall and wide.
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".dt input, .dt select, .dt textarea, .dt button, .ws-details-btn"))
          .map((el) => ({ id: el.id || el.textContent, r: el.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.height < 24 || x.r.width < 24))
          .map((x) => x.id),
      );
      expect(small).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await context.close();
    });
  }

  it("shows the form in Spanish for an es-ES browser", async () => {
    const context = await browser.newContext({ locale: "es-ES" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: "Exportar PDF de impresión" }).waitFor();
    await page.getByRole("button", { name: "Mis libros" }).click();
    await page.getByLabel("Nombre del libro").fill("Libro de datos");
    await page.getByRole("button", { name: "Crear libro" }).click();
    await page.locator("#ed-text").waitFor();
    await page.getByRole("button", { name: "Editar los datos y la portada del libro" }).click();
    await page.getByRole("heading", { name: "Datos del libro" }).waitFor();
    for (const label of ["Título", "Subtítulo", "Editorial", "Palabras clave", "Serie", "Tamaño de corte"]) expect(await field(page, label).count(), label).toBe(1);
    expect(await page.getByText("Imagen de portada frontal").count()).toBe(1);
    await context.close();
  });
});

describe("web app, copies and folders", () => {
  const OZ = join(process.cwd(), "sample", "oz");

  /** A page without the folder picker, so "Import a folder" falls back to the plain file chooser that tests can drive. */
  async function plainPage(locale = "en-US") {
    const context = await browser.newContext({ acceptDownloads: true, locale });
    await context.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
    });
    const page = await context.newPage();
    await page.goto(`${base}?sample=leyendas`);
    await page.getByRole("button", { name: /Export print PDF|Exportar PDF/ }).waitFor();
    return { context, page };
  }

  async function exportPdfPages(page: Page): Promise<number> {
    await page.locator(".bs-page, canvas, svg").first().waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const r = await checkKdpPdf(new Uint8Array(await readFile((await download.path()))), trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    return r.pages;
  }

  it("turns the sample/oz folder into a book that exports a PDF with the same number of pages as opening the folder", async () => {
    const { context, page } = await plainPage();
    // Opening the folder directly (the old way).
    await page.locator("#folder-input").setInputFiles(OZ);
    await page.waitForFunction(() => document.title.includes("oz"));
    await page.locator("option", { hasText: "Wonderful Wizard of Oz" }).first().waitFor({ state: "attached", timeout: 60_000 });
    const direct = await exportPdfPages(page);

    // Importing it as a book.
    await page.getByRole("button", { name: "My books" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import a folder" }).click()]);
    await chooser.setFiles(OZ);
    await page.getByRole("button", { name: /^Open The Wonderful Wizard of Oz/ }).click();
    const imported = await exportPdfPages(page);
    expect(imported).toBe(direct);
    expect(imported).toBeGreaterThan(24);
    await context.close();
  });

  it("exports with the free plan a 7 × 10 PDF with footnotes at the foot of the page and the full cover, with no gate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bs-free-"));
    await writeFile(join(dir, "Free book.md"), "---\nbook: true\ntitle: Free book\nauthor: A. Writer\nlanguage: en\ntheme: elegant\ntrim: 7x10\nfootnotes: page\n---\n\n## Chapters\n\n1. [[One]]\n");
    const body = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} walks on, with a note.[^n${i}]`).join("\n\n");
    const notes = Array.from({ length: 40 }, (_, i) => `[^n${i}]: Note number ${i + 1}, set at the foot of its page.`).join("\n");
    await writeFile(join(dir, "One.md"), `# One\n\n${body}\n\n${notes}\n`);
    const { context, page } = await plainPage();
    await page.getByRole("button", { name: "My books" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import a folder" }).click()]);
    await chooser.setFiles(dir);
    await page.getByRole("button", { name: /^Open Free book/ }).click();
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    // No dialog asks for Pro: the download starts at once.
    const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    expect(pdf.suggestedFilename()).toContain("7x10");
    expect(pdf.suggestedFilename()).not.toContain("SAMPLE");
    const r = await checkKdpPdf(new Uint8Array(await readFile(await pdf.path())), trimById("7x10")!, { bleed: false });
    expect(r.errors).toEqual([]);
    await page.getByRole("tab", { name: "KDP" }).click();
    const [cover] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export cover PDF" }).click()]);
    expect(cover.suggestedFilename()).toMatch(/cover.*\.pdf$/);
    expect(await page.getByText("part of Book Studio Pro").count()).toBe(0);
    await context.close();
  });

  it("downloads a copy as a zip and opens it again as a second book", async () => {
    const { context, page } = await plainPage();
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Book name").fill("Copy me");
    await page.getByLabel("The Starter Book template").check();
    await page.getByRole("button", { name: "Create book" }).click();
    await page.locator("#ed-text").waitFor();
    await page.locator("#ed-text").fill("Words that must survive the copy.");
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByRole("button", { name: "Open Copy me" }).waitFor();
    expect(await page.getByText("No copy yet").count()).toBe(1);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download a copy of Copy me as a zip" }).click()]);
    expect(download.suggestedFilename()).toBe("Copy me.zip");
    const path = await download.path();
    const zip = await JSZip.loadAsync(await readFile(path));
    expect(Object.keys(zip.files)).toContain("Copy me.md");
    expect(await page.getByText("No copy yet").count()).toBe(0);

    const input = page.locator("#proj-import-zip + button + input[type=file]");
    await input.setInputFiles(path);
    await page.getByText("Imported “Copy me”.").waitFor();
    expect(await page.getByRole("button", { name: /^Open Copy me/ }).count()).toBe(2);
    await context.close();
  });

  it("shows the import box and the copy buttons in Spanish", async () => {
    const { context, page } = await plainPage("es-ES");
    await page.getByRole("button", { name: "Mis libros" }).click();
    await page.getByRole("heading", { name: "Traer un libro" }).waitFor();
    for (const name of ["Importar una copia (.zip)", "Importar una carpeta"]) expect(await page.getByRole("button", { name }).count(), name).toBe(1);
    await context.close();
  });
});

describe("web app, import a manuscript", () => {
  const MANUSCRIPT = "# La casa\n\nLa casa estaba vacía.\n\n# El jardín\n\nCrecían flores.\n\n# Sobre el autor\n\nNació en el sur.\n";

  it("turns a pasted text into chapters that survive a reload and export a PDF that passes the KDP check", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByRole("heading", { name: "Import a manuscript" }).waitFor();
    // Nothing happens (and a message says why) when there is nothing to import.
    await page.getByRole("button", { name: "Import as a new book" }).click();
    await page.getByText("Choose a file or paste some text first.").waitFor();

    await page.getByLabel("Or paste the text").fill(MANUSCRIPT);
    await page.getByLabel("Title of the new book (optional)").fill("Casa vieja");
    await page.getByRole("button", { name: "Import as a new book" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await page.locator(".ch-pick").allTextContents()).toEqual(["La casa", "El jardín", "Sobre el autor"]);

    await page.goto(base);
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByRole("button", { name: "Open Casa vieja" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await page.locator(".ch-pick").count()).toBe(3);

    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const r = await checkKdpPdf(new Uint8Array(await readFile(await download.path())), trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    await context.close();
  });

  it("imports a .md file chosen from disk", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Text file").setInputFiles({ name: "diario.md", mimeType: "text/markdown", buffer: Buffer.from("# Uno\n\na\n\n# Dos\n\nb\n") });
    await page.getByRole("button", { name: "Import as a new book" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await page.locator(".ch-pick").allTextContents()).toEqual(["Uno", "Dos"]);
    await context.close();
  });

  it("imports a Word file with a report, keeps the picture, and exports a PDF and an EPUB", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Text file").setInputFiles(new URL("../tests/fixtures/docx/word-like.docx", import.meta.url).pathname);
    await page.getByRole("button", { name: "Import as a new book" }).click();
    // The report lists what was kept and what was left out.
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    expect(await dialog.textContent()).toContain("1 table was left out");
    expect(await dialog.textContent()).toContain("1 picture has no description");
    await page.getByRole("button", { name: "Open the book" }).click();
    await page.locator("#ed-text").waitFor();
    expect(await page.locator(".ch-pick").allTextContents()).toEqual(["Dedication", "The storm", "The morning", "About the author"]);

    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const r = await checkKdpPdf(new Uint8Array(await readFile(await pdf.path())), trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);

    const [epub] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export EPUB" }).click()]);
    const bytes = await readFile(await epub.path());
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some((f) => /docx-image-1\.png$/.test(f))).toBe(true);
    const file = join(await mkdtemp(join(tmpdir(), "bs-epub-")), epub.suggestedFilename());
    await writeFile(file, bytes);
    const check = await epubcheck(file);
    if (check) expect(check.ok, check.log).toBe(true);
    await context.close();
  });

  it("says so when the file is not a Word document", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Text file").setInputFiles({ name: "broken.docx", mimeType: "application/octet-stream", buffer: Buffer.from("not a zip") });
    await page.getByRole("button", { name: "Import as a new book" }).click();
    await page.getByText("This file is not a Word .docx document.").waitFor();
    await context.close();
  });

  it("has no serious accessibility violations on the books screen with the import form", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByRole("heading", { name: "Import a manuscript" }).waitFor();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await context.close();
  });
});

describe("web app, first screen", () => {
  const DOCX = new URL("../tests/fixtures/docx/spanish-patterns.docx", import.meta.url).pathname;

  it("turns a Word file dropped on the empty first screen into a book with its preview and a working PDF button", async () => {
    const context = await browser.newContext({ locale: "es-ES" });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("heading", { name: "Tu libro listo para Amazon en 10 minutos" }).waitFor();
    const bytes = [...(await readFile(DOCX))];
    await page.locator("#land-drop").evaluate(async (el, data) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], "spanish-patterns.docx"));
      el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, bytes);
    // A Word file with things left out shows its report first; close it.
    const report = page.getByRole("dialog");
    if (await report.waitFor({ timeout: 15_000 }).then(() => true, () => false)) await report.getByRole("button").last().click();
    await page.locator("#ed-text").waitFor();
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    expect(await page.getByRole("button", { name: "Exportar PDF de impresión" }).isEnabled()).toBe(true);
    await context.close();
  });

  it("takes a Word file chosen with the drop zone, and says so when the file is of another kind", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator("#land-drop").waitFor();
    await page.locator("input[type=file][aria-label='Choose your manuscript']").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("x") });
    await page.getByText("Drop a Word (.docx), .md or .txt file.").waitFor();
    await page.locator("input[type=file][aria-label='Choose your manuscript']").setInputFiles({ name: "diary.md", mimeType: "text/markdown", buffer: Buffer.from("# One\n\na\n\n# Two\n\nb\n") });
    await page.locator("#ed-text").waitFor();
    expect(await page.locator(".ch-pick").allTextContents()).toEqual(["One", "Two"]);
    await context.close();
  });

  it("opens with the drop zone focused when the link says ?start=import, and with the sample when it names one", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${base}?start=import`);
    await page.locator("#land-drop").waitFor();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("land-drop");
    await page.getByRole("button", { name: "See a sample book" }).click();
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    await context.close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations on the empty first screen and on the Spanish landing page, ${label}`, async () => {
      const context = await browser.newContext({ viewport, locale: "es-ES" });
      const page = await context.newPage();
      for (const url of [base, `${base}es/`, `${base}en/`]) {
        await page.goto(url);
        await page.locator("h1, h2").first().waitFor();
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
        expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${url}: ${v.id}`)).toEqual([]);
      }
      await context.close();
    });
  }
});

/** A Word file of about `words` words in `chapters` chapters, made here with jszip (headings, then body paragraphs). */
async function bigDocx(words: number, chapters: number): Promise<Buffer> {
  const vocabulary = "la casa estaba vacía cuando llegó el viento del norte y las hojas caían sobre el camino mientras nadie hablaba de lo que había pasado en el pueblo aquella noche de invierno".split(" ");
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const perChapter = Math.floor(words / chapters);
  let n = 0;
  const body: string[] = [para("La noche larga", "Title"), para("Ana Soto", "Author")];
  for (let c = 1; c <= chapters; c++) {
    body.push(para(`Capítulo ${c}`, "Heading1"));
    for (let w = 0; w < perChapter; w += 100) {
      const text: string[] = [];
      for (let k = 0; k < Math.min(100, perChapter - w); k++) text.push(vocabulary[n++ % vocabulary.length]);
      body.push(para(`${text.join(" ")}.`));
    }
  }
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

async function dropFile(page: Page, name: string, data: Buffer): Promise<void> {
  await page.locator("#land-drop").evaluate(async (el, [fileName, bytes]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], fileName));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [name, [...data]] as const);
}

describe("web app, first-book guide", () => {
  it("takes a 60,000-word Word file to a KDP-valid PDF in four steps, four clicks and under a minute", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "es-ES" });
    const page = await context.newPage();
    const docx = await bigDocx(60_000, 30);
    await page.goto(base);
    await page.locator("#land-drop").waitFor();
    const t0 = Date.now();
    await dropFile(page, "la-noche-larga.docx", docx);
    // Step 1: the book is in. The guide's bar shows the four steps and where we are.
    await page.getByRole("heading", { name: "Paso 1 de 4: Sube" }).waitFor({ timeout: 60_000 });
    expect(await page.locator(".wiz-step").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Sube"), expect.stringContaining("Estilo"), expect.stringContaining("Datos"), expect.stringContaining("Descarga")]));
    expect(await page.getByText("Tu manuscrito está dentro: 30 capítulos.").count()).toBe(1);
    let clicks = 0;
    const click = async (name: string | RegExp) => {
      clicks++;
      await page.getByRole("button", { name }).click();
    };
    await click("Siguiente");
    await page.getByRole("heading", { name: "Paso 2 de 4: Estilo" }).waitFor();
    await click("Siguiente");
    await page.getByRole("heading", { name: "Paso 3 de 4: Datos" }).waitFor();
    // Typing the title is not a click.
    await page.getByLabel("Título", { exact: true }).fill("La noche larga");
    await click("Siguiente");
    await page.getByRole("heading", { name: "Paso 4 de 4: Descarga" }).waitFor();
    clicks++;
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Descargar PDF de imprenta" }).click()]);
    const r = await checkKdpPdf(new Uint8Array(await readFile(await download.path())), trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    expect(r.pages).toBeGreaterThan(100);
    const seconds = (Date.now() - t0) / 1000;
    process.stdout.write(`Word to PDF in ${seconds.toFixed(1)} s, ${clicks} clicks, ${r.pages} pages\n`);
    expect(clicks).toBeLessThanOrEqual(4);
    expect(seconds).toBeLessThan(60);
    // The book carries the title that was typed.
    expect(await page.locator(".ch-pick").count()).toBe(30);
    await context.close();
  });

  it("shows a real thumbnail for each free style, changes the book with the choice, remembers the step after a reload, and goes away on Skip", async () => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator("#land-drop").waitFor();
    await dropFile(page, "diary.docx", await bigDocx(3000, 3));
    await page.getByRole("heading", { name: "Step 1 of 4: Upload" }).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("heading", { name: "Step 2 of 4: Style" }).waitFor();
    // Five free styles, each with a picture of the first page, and 6 × 9 chosen.
    await page.locator(".wiz-thumb canvas").nth(4).waitFor({ timeout: 30_000 });
    expect(await page.locator(".wiz-style input").count()).toBe(5);
    expect(await page.locator(".wiz-thumb canvas").count()).toBe(5);
    expect(await page.locator("#wiz-trim").inputValue()).toBe("6x9");
    // Thumbnails are not blank: some pixels are dark.
    const ink = await page.locator(".wiz-thumb canvas").first().evaluate((c) => {
      const el = c as HTMLCanvasElement;
      const data = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 200) dark++;
      return dark;
    });
    expect(ink).toBeGreaterThan(50);
    await page.getByLabel("Elegant").check();
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    // Reload: back on the same step, with the same style.
    await page.waitForTimeout(800);
    await page.reload();
    await page.getByRole("button", { name: "My books" }).click().catch(() => undefined);
    await page.locator(".proj-item").getByRole("button", { name: /^Open / }).first().click();
    await page.getByRole("heading", { name: "Step 2 of 4: Style" }).waitFor();
    expect(await page.getByLabel("Elegant").isChecked()).toBe(true);
    await page.getByRole("button", { name: "Skip the first book guide" }).click();
    await page.locator(".wiz-box").waitFor({ state: "hidden" });
    // Skipped for good: opening the book again shows no guide.
    await page.reload();
    await page.locator(".proj-item").getByRole("button", { name: /^Open / }).first().click();
    await page.locator("#ed-text").waitFor();
    expect(await page.locator(".wiz-box").isHidden()).toBe(true);
    await context.close();
  });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 844 }]] as const) {
    it(`has no serious accessibility violations on the four steps, ${label}`, async () => {
      const context = await browser.newContext({ viewport, locale: "en-US" });
      const page = await context.newPage();
      await page.goto(base);
      await page.locator("#land-drop").waitFor();
      await dropFile(page, "diary.docx", await bigDocx(2000, 2));
      for (const [n, name] of [[1, "Upload"], [2, "Style"], [3, "Details"], [4, "Download"]] as const) {
        await page.getByRole("heading", { name: `Step ${n} of 4: ${name}` }).waitFor({ timeout: 60_000 });
        if (n === 2) await page.locator(".wiz-thumb canvas").nth(4).waitFor({ timeout: 30_000 });
        const { violations } = await new AxeBuilder({ page }).include(".wiz-box").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
        expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `step ${n}: ${v.id}`)).toEqual([]);
        if (n < 4) await page.getByRole("button", { name: "Next" }).click();
      }
      await context.close();
    });
  }
});

describe("web app, offline", () => {
  it("writes a service worker that saves the app and the fonts, and a manifest that can be installed", async () => {
    const sw = await readFile("dist/web/sw.js", "utf8");
    expect(sw).not.toContain("__BUILD__");
    expect(sw).not.toContain("__FILES__");
    expect(sw).toMatch(/const BUILD = "[0-9a-f]{12}"/);
    const files = JSON.parse(/const FILES = (\[.*\]);/.exec(sw)?.[1] ?? "[]") as string[];
    for (const f of ["./", "index.html", "app.js", "layout-worker.js", "app.css", "studio.css", "app.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "fonts/EBGaramond-Regular.ttf"]) expect(files, f).toContain(f);
    expect(files.some((f) => f.startsWith("sample/") || f.startsWith("en/") || f.startsWith("es/"))).toBe(false);
    const res = await fetch(`${base}app.webmanifest`);
    expect(((await res.json()) as { name: string }).name).toBe("Book Studio");
    expect((await fetch(`${base}icons/icon-512.png`)).status).toBe(200);
  });

  it("opens, lets you write a book and exports a PDF that passes the KDP check with no network", async () => {
    const context = await browser.newContext({ acceptDownloads: true, locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${base}?sample=leyendas`);
    await page.getByRole("button", { name: "Export print PDF" }).waitFor();
    // Wait until the worker controls the page and has saved the app.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }));
    });
    const saved = await page.evaluate(async () => (await (await caches.open((await caches.keys()).find((k) => k.startsWith("bs-core-")) ?? "")).keys()).map((r) => new URL(r.url).pathname.replace(/^\//, "")));
    expect(saved).toContain("app.js");
    expect(saved.some((p) => p.startsWith("fonts/"))).toBe(true);

    await context.setOffline(true);
    await page.goto(base);
    await page.getByRole("heading", { name: "My books" }).or(page.getByRole("button", { name: "Export print PDF" })).first().waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "My books" }).click();
    await page.getByLabel("Book name").fill("Offline book");
    await page.getByLabel("The Starter Book template").check();
    await page.getByRole("button", { name: "Create book" }).click();
    await page.locator("#ed-text").waitFor();
    await page.locator("#ed-text").fill("Written with no network at all.");
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    const r = await checkKdpPdf(new Uint8Array(await readFile(await download.path())), trimById("6x9")!, { bleed: false });
    expect(r.errors).toEqual([]);
    expect(r.pages).toBeGreaterThan(0);
    await context.close();
  });
});

describe("web app, publish checklist", () => {
  async function startBook(page: Page, name: string, locale = "en"): Promise<void> {
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: locale === "es" ? "Exportar PDF de impresión" : "Export print PDF" }).waitFor();
    await page.getByRole("button", { name: locale === "es" ? "Mis libros" : "My books" }).click();
    await page.locator("#proj-name").fill(name);
    await page.locator(".proj-new:not(.proj-import) button[type=submit]").click();
    await page.locator("#ed-text").waitFor();
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
  }

  it("lists what is missing, takes you to the fix, and says the book is ready once it is", async () => {
    const page = await (await browser.newContext({ locale: "en-US" })).newPage();
    await startBook(page, "Checklist test");
    await page.getByRole("button", { name: "Check what is missing before publishing on KDP" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish checklist" });
    await dialog.waitFor();
    const todo = await dialog.locator(".pub-todo .pub-text").allTextContents();
    expect(todo).toEqual(expect.arrayContaining([expect.stringContaining("author"), expect.stringContaining("description"), expect.stringContaining("cover"), expect.stringContaining("no text yet")]));
    expect(await dialog.getByText("Some things are still missing").count()).toBe(1);
    expect(await dialog.getByText("Next steps on KDP").count()).toBe(1);
    expect(await dialog.getByText(/the spine at about [0-9.]+ in/).count()).toBe(1);

    // A fix button closes the window and opens the book form.
    await dialog.getByRole("button", { name: "Open the book details" }).first().click();
    await page.getByRole("heading", { name: "Book details" }).waitFor();
    expect(await dialog.isVisible()).toBe(false);
    await page.locator(".dt").getByLabel("Author", { exact: true }).fill("Ana");
    await page.locator(".dt").getByLabel("Description", { exact: true }).fill("Una historia.");
    await page.locator(".ed-status", { hasText: "Saved" }).waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Check what is missing before publishing on KDP" }).click();
    const again = await page.getByRole("dialog", { name: "Publish checklist" }).locator(".pub-todo .pub-text").allTextContents();
    expect(again.some((t) => /author|description/.test(t))).toBe(false);
    expect(again.some((t) => /cover/.test(t))).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.getByRole("dialog").count()).toBe(0);
    await page.close();
  });

  it("is in Spanish for an es-ES browser", async () => {
    const page = await (await browser.newContext({ locale: "es-ES" })).newPage();
    await startBook(page, "Lista prueba", "es");
    await page.getByRole("button", { name: "Revisar qué falta antes de publicar en KDP" }).click();
    const dialog = page.getByRole("dialog", { name: "Lista de publicación" });
    await dialog.waitFor();
    expect(await dialog.getByText("Siguientes pasos en KDP").count()).toBe(1);
    expect(await dialog.getByText("Pendiente").count()).toBeGreaterThan(0);
    await page.close();
  });

  for (const [label, size] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 800 }]] as const) {
    it(`has no serious accessibility violations with the checklist open, ${label}`, async () => {
      const page = await (await browser.newContext({ locale: "en-US", viewport: size })).newPage();
      await page.goto(`${base}?sample=oz`);
      await page.getByRole("button", { name: "My books" }).click();
      await page.locator("#proj-name").fill("A11y test");
      await page.locator(".proj-new:not(.proj-import) button[type=submit]").click();
      await page.locator("#ed-text").waitFor();
      if (size.width < 900) await page.getByRole("tab", { name: "Chapters" }).click();
      await page.getByRole("button", { name: "Check what is missing before publishing on KDP" }).click();
      await page.getByRole("dialog", { name: "Publish checklist" }).waitFor();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      await page.close();
    });
  }
});

describe("web app, versions and find and replace", () => {
  async function startBook(page: Page, name: string, locale = "en"): Promise<void> {
    await page.goto(`${base}?sample=oz`);
    await page.getByRole("button", { name: locale === "es" ? "Exportar PDF de impresión" : "Export print PDF" }).waitFor();
    await page.getByRole("button", { name: locale === "es" ? "Mis libros" : "My books" }).click();
    await page.locator("#proj-name").fill(name);
    await page.locator("#proj-new-title").locator("xpath=..").locator("input[value=template]").check();
    await page.locator(".proj-new:not(.proj-import) button[type=submit]").click();
    await page.locator("#ed-text").waitFor();
    await page.locator(".bs-page.is-painted").first().waitFor({ timeout: 60_000 });
  }
  const chapter = (page: Page, title: string) => page.getByRole("button", { name: title, exact: true });
  const saved = (page: Page) => page.locator(".ed-status", { hasText: "Saved" }).waitFor({ state: "attached" });

  it("saves a version, restores it, and a restore can be undone", async () => {
    const page = await (await browser.newContext({ locale: "en-US" })).newPage();
    await startBook(page, "Versions test");
    await chapter(page, "Chapter Two").click();
    await page.locator("#ed-text").fill("The first draft.");
    await saved(page);

    await page.getByRole("button", { name: "Saved versions of this book" }).click();
    const dialog = page.getByRole("dialog", { name: "Saved versions" });
    await dialog.waitFor();
    await dialog.getByText("No saved versions yet.").waitFor();
    await dialog.getByLabel("Name (optional)").fill("First draft");
    await dialog.getByRole("button", { name: "Save a version now" }).click();
    await dialog.getByText("Saved by you: First draft").waitFor();
    await page.keyboard.press("Escape");

    await page.locator("#ed-text").fill("A much worse second draft.");
    await saved(page);
    await page.getByRole("button", { name: "Saved versions of this book" }).click();
    await dialog.getByRole("button", { name: /^Restore the version from/ }).click();
    await dialog.getByText("Restored. What you had before is saved as a version too.").waitFor();
    expect(await dialog.getByText("Saved before a restore").count()).toBe(1);
    await page.keyboard.press("Escape");
    expect(await page.locator("#ed-text").inputValue()).toBe("The first draft.");

    // The restored text is kept after a reload, and undoing the restore brings the worse draft back.
    await saved(page);
    await page.goto(base);
    await page.getByRole("button", { name: "Open Versions test" }).click();
    await chapter(page, "Chapter Two").click();
    expect(await page.locator("#ed-text").inputValue()).toBe("The first draft.");
    await page.getByRole("button", { name: "Saved versions of this book" }).click();
    const rows = dialog.locator(".ver-item");
    await rows.filter({ hasText: "Saved before a restore" }).getByRole("button", { name: /^Restore/ }).click();
    await dialog.getByText("Restored.").waitFor();
    await page.keyboard.press("Escape");
    expect(await page.locator("#ed-text").inputValue()).toBe("A much worse second draft.");
    await page.close();
  });

  it("saves a version when you export, and can delete one", async () => {
    const context = await browser.newContext({ locale: "en-US", acceptDownloads: true });
    const page = await context.newPage();
    await startBook(page, "Export version");
    await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: "Export print PDF" }).click()]);
    await page.getByRole("button", { name: "Saved versions of this book" }).click();
    const dialog = page.getByRole("dialog", { name: "Saved versions" });
    await dialog.getByText("Saved when you exported").waitFor();
    await dialog.getByRole("button", { name: /^Delete the version from/ }).click();
    await dialog.getByText("No saved versions yet.").waitFor();
    await context.close();
  });

  it("finds and replaces across the book, saves a version first, and goes to a chapter", async () => {
    const page = await (await browser.newContext({ locale: "en-US" })).newPage();
    await startBook(page, "Find test");
    await chapter(page, "Chapter Two").click();
    await page.locator("#ed-text").fill("Keep going, keep going.");
    await saved(page);

    await page.getByRole("button", { name: "Find and replace in the whole book" }).click();
    const dialog = page.getByRole("dialog", { name: "Find and replace" });
    await dialog.getByText("Type something to find.").waitFor();
    await dialog.getByLabel("Find").fill("keep going");
    await dialog.getByText("2 matches").first().waitFor();
    // Case matters when asked.
    await dialog.getByLabel("Match case").check();
    await dialog.getByText("1 match").first().waitFor();
    await dialog.getByLabel("Match case").uncheck();
    await dialog.getByLabel("Replace with").fill("go on");
    await dialog.getByRole("button", { name: "Replace all" }).click();
    await dialog.getByText("Replaced 2 matches. Your earlier text is saved as a version.").waitFor();
    await page.keyboard.press("Escape");
    expect(await page.locator("#ed-text").inputValue()).toBe("go on, go on.");

    // Nothing is left to find, and the version from before the replace is in the list.
    await page.getByRole("button", { name: "Find and replace in the whole book" }).click();
    await dialog.getByLabel("Find").fill("keep going");
    await dialog.getByText("No matches.").waitFor();
    await dialog.getByLabel("Find").fill("go on");
    await dialog.getByRole("button", { name: "Open Chapter Two" }).click();
    expect(await dialog.count()).toBe(0);
    await page.getByRole("button", { name: "Saved versions of this book" }).click();
    await page.getByRole("dialog", { name: "Saved versions" }).getByText("Saved before a replace").waitFor();
    await page.close();
  });

  it("shows both windows in Spanish for an es-ES browser", async () => {
    const page = await (await browser.newContext({ locale: "es-ES" })).newPage();
    await startBook(page, "Libro versiones", "es");
    await page.getByRole("button", { name: "Buscar y reemplazar en todo el libro" }).click();
    const find = page.getByRole("dialog", { name: "Buscar y reemplazar" });
    await find.getByText("Escribe algo para buscar.").waitFor();
    expect(await find.getByLabel("Distinguir mayúsculas").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Versiones guardadas de este libro" }).click();
    const ver = page.getByRole("dialog", { name: "Versiones guardadas" });
    await ver.getByText("Todavía no hay versiones guardadas.").waitFor();
    expect(await ver.getByRole("button", { name: "Guardar una versión ahora" }).count()).toBe(1);
    await page.close();
  });

  for (const [label, size] of [["desktop", { width: 1280, height: 800 }], ["mobile 390 px", { width: 390, height: 800 }]] as const) {
    it(`has no serious accessibility violations with the windows open, ${label}`, async () => {
      const page = await (await browser.newContext({ locale: "en-US", viewport: size })).newPage();
      await page.goto(`${base}?sample=oz`);
      await page.getByRole("button", { name: "My books" }).click();
      await page.locator("#proj-name").fill("A11y versions");
      await page.locator(".proj-new:not(.proj-import) button[type=submit]").click();
      await page.locator("#ed-text").waitFor();
      if (size.width < 900) await page.getByRole("tab", { name: "Chapters" }).click();
      for (const [button, dialogName] of [["Find and replace in the whole book", "Find and replace"], ["Saved versions of this book", "Saved versions"]] as const) {
        await page.getByRole("button", { name: button }).click();
        const dialog = page.getByRole("dialog", { name: dialogName });
        await dialog.waitFor();
        if (dialogName === "Find and replace") await dialog.getByLabel("Find").fill("Chapter");
        else {
          await dialog.getByRole("button", { name: "Save a version now" }).click();
          await dialog.locator(".ver-item").waitFor();
        }
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
        expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
        const small = await dialog.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("input,button")).filter((x) => x.getBoundingClientRect().width > 0 && (x.getBoundingClientRect().height < 24 || x.getBoundingClientRect().width < 24)).map((x) => x.id || x.textContent));
        expect(small).toEqual([]);
        await page.keyboard.press("Escape");
      }
      await page.close();
    });
  }
});
