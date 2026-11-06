/// <reference types="node" />
import { AxeBuilder } from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
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
    expect((await tocOrder(page)).slice(0, 3)).toEqual(["Chapter One", "Chapter Two", "Chapter Three"]);
    const two = page.getByRole("button", { name: "Chapter Two", exact: true });
    await two.focus();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await chapterNames(page)).toEqual(["Dedication", "Chapter Two", "Chapter One", "Chapter Three", "About the author"]);
    // The focus stays on the chapter that moved.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Chapter Two");
    await vi.waitFor(async () => expect((await tocOrder(page)).slice(0, 3)).toEqual(["Chapter Two", "Chapter One", "Chapter Three"]), { timeout: 10_000, interval: 200 });
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
    // A problem in the book's own note cannot be edited yet, and says so.
    await page.locator(".bs-panel-problems li", { hasText: "No author" }).locator(".bs-link").click();
    await page.getByText("book's own note").waitFor();
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
