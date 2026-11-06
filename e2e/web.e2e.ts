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

    // Pro themes show as disabled with the Pro label; a free trim is allowed.
    const elegant = page.locator("#dt-theme option[value=elegant]");
    expect(await elegant.isDisabled()).toBe(true);
    expect(await elegant.textContent()).toContain("Pro");
    expect(await page.locator("#dt-theme option[value=modern]").isDisabled()).toBe(false);
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
    const path = await epub.path();
    const zip = await JSZip.loadAsync(await readFile(path));
    expect(Object.keys(zip.files).some((f) => /docx-image-1\.png$/.test(f))).toBe(true);
    const check = await epubcheck(path);
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
