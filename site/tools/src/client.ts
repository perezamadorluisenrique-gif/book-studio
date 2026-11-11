// The browser side of the free KDP tools: builds the form of the tool a page asks for
// (<div data-tool="spine">), recomputes on every change, and nothing leaves the device.
// The numbers come from kdp.ts; this file only draws and wires.

import genres from "../data/genres.json";
import { checkIsbn } from "../../../src/engine/cover/isbn";
import { barcodeSvg, barRuns, MODULES, QUIET } from "./barcode";
import { coverPixels, coverSize, FIGURES, INKS, insideMargin, margins, minListPrice, pageRange, pagesProblem, printingCost, round, royalty, royaltyRate, spineHasText, spineWidth, TRIM_SPECS, trimSpec, wordsToPages, type Ink, type TrimSpec } from "./kdp";
import { appHasTrim, appLink, query } from "./links";
import { templatePdf } from "./pdf";
import { fill, routePath, STRINGS, type Lang, type Strings } from "./strings";
import { coverTemplate } from "./template";

type Attrs = Record<string, string | number | boolean | undefined>;

function h(tag: string, attrs: Attrs = {}, ...kids: (Node | string | null)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

const lang: Lang = document.documentElement.lang === "es" ? "es" : "en";
const S: Strings = STRINGS[lang];
const nf = (d: number) => new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
const num = (n: number, d = 3) => nf(d).format(n);
const inMm = (n: number) => `${num(n)} ${S.in} (${num(n * 25.4, 1)} ${S.mm})`;
const money = (n: number) => `$${new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(n)}`;
const inkLabel: Record<Ink, string> = { bw_white: S.inkBwWhite, bw_cream: S.inkBwCream, color_standard: S.inkColorStandard, color_premium: S.inkColorPremium };
const trimLabel = (t: { width: number; height: number }) => `${num(t.width, t.width % 0.5 === 0 ? 1 : 2).replace(/,0$|\.0$/, "")} × ${num(t.height, t.height % 0.5 === 0 ? 1 : 2).replace(/,0$|\.0$/, "")} ${S.in}`;

const params = new URLSearchParams(location.search);
const root = document.querySelector<HTMLElement>("[data-tool]")?.dataset.root ?? "../../../";

// ---- form pieces ----

let counter = 0;
const uid = (s: string) => `${s}-${++counter}`;

function numberField(name: string, label: string, def: number, o: { min?: number; max?: number; step?: number } = {}): { box: HTMLElement; input: HTMLInputElement } {
  const id = uid(name);
  const input = h("input", { id, name, type: "number", inputmode: "decimal", value: params.get(name) ?? String(def), min: o.min, max: o.max, step: o.step ?? "any" }) as HTMLInputElement;
  return { box: h("div", { class: "field" }, h("label", { for: id, text: label }), input), input };
}

function selectField(name: string, label: string, options: [string, string][], def: string): { box: HTMLElement; input: HTMLSelectElement } {
  const id = uid(name);
  const want = params.get(name);
  const value = options.some(([v]) => v === want) ? want! : def;
  const input = h("select", { id, name }, ...options.map(([v, text]) => h("option", { value: v, text, selected: v === value }))) as HTMLSelectElement;
  return { box: h("div", { class: "field" }, h("label", { for: id, text: label }), input), input };
}

function checkField(name: string, label: string): { box: HTMLElement; input: HTMLInputElement } {
  const id = uid(name);
  const input = h("input", { id, name, type: "checkbox", checked: params.get(name) === "1" }) as HTMLInputElement;
  return { box: h("div", { class: "field check" }, input, h("label", { for: id, text: label })), input };
}

const inkOptions = (): [string, string][] => INKS.map((i) => [i, inkLabel[i]]);
const trimOptions = (): [string, string][] => TRIM_SPECS.map((t) => [t.id, trimLabel(t)]);

function dl(rows: [string, string][]): HTMLElement {
  return h("dl", { class: "facts" }, ...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
}

function links(items: [string, string][]): HTMLElement {
  return h("div", { class: "next" }, h("h2", { text: S.next }), h("ul", {}, ...items.map(([href, text]) => h("li", {}, h("a", { href, text })))));
}

function problem(text: string): HTMLElement {
  return h("p", { class: "problem", role: "alert", text });
}

const pagesMessage = (trim: TrimSpec, ink: Ink, pages: number): string | null => {
  const p = pagesProblem(trim, ink, pages);
  if (!p) return null;
  const r = pageRange(trim, ink);
  if (p === "format") return S.badPages;
  if (p === "unavailable") return S.notSold;
  return fill(p === "low" ? S.tooLow : S.tooHigh, { n: p === "low" ? r![0] : r![1] });
};

/** Wires inputs to a render function that fills `out`, and runs it once. */
function mount(host: HTMLElement, fields: HTMLElement[], render: (out: HTMLElement) => void): void {
  const out = h("div", { class: "tool-out", "aria-live": "polite" });
  const form = h("form", { class: "tool-form", novalidate: true }, ...fields);
  form.addEventListener("submit", (e) => e.preventDefault());
  const run = () => {
    out.textContent = "";
    render(out);
  };
  // Only "input": it fires for typing, for menus and for boxes, and a "change" on blur would rebuild the result
  // between the mouse going down and up on a link below it, and lose the click.
  form.addEventListener("input", run);
  host.replaceChildren(form, out, h("p", { class: "tool-note", text: S.offline }));
  run();
}

function download(name: string, type: string, data: Blob | string | Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h("a", { href: url, download: name }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function button(text: string, on: () => void): HTMLElement {
  const b = h("button", { type: "button", class: "btn", text });
  b.addEventListener("click", on);
  return b;
}

// ---- the tools ----

function toolSpine(host: HTMLElement): void {
  const pages = numberField("pages", S.pages, 300, { min: 1, step: 1 });
  const ink = selectField("ink", S.paper, inkOptions(), "bw_white");
  mount(host, [pages.box, ink.box], (out) => {
    const p = Number(pages.input.value);
    const i = ink.input.value as Ink;
    if (!Number.isInteger(p) || p < 1) return void out.append(problem(S.badPages));
    const spine = spineWidth(p, i);
    const clear = FIGURES.spineTextClearance;
    const text = spineHasText(p)
      ? fill(S.spineTextYes, { n: FIGURES.spineTextMinPages, c: num(clear, 4), cmm: num(clear * 25.4, 1), w: num(Math.max(0, spine - 2 * clear)), wmm: num(Math.max(0, spine - 2 * clear) * 25.4, 1) })
      : fill(S.spineTextNo, { n: FIGURES.spineTextMinPages });
    const q = { pages: p, ink: i };
    out.append(
      h("p", { class: "big", text: `${S.spineWidth}: ${inMm(spine)}` }),
      dl([[S.spineText, text]]),
      h("p", { text: S.spineHint }),
      links([
        [`${root}${routePath(lang, "cover")}${query(q)}`, S.toCover],
        [`${root}${routePath(lang, "cost")}${query(q)}`, S.toCost],
      ]),
    );
  });
}

function templateLabels(c: { width: number; height: number }, pages: number) {
  return { title: S.tplTitle, back: S.back, spine: S.spine, front: S.front, bleed: S.tplBleed, trim: S.tplTrim, safe: S.tplSafe, barcode: S.tplBarcode, noSpineText: S.tplNoSpine, size: fill(S.tplSize, { w: num(c.width), h: num(c.height), p: pages }) };
}

function drawPng(c: ReturnType<typeof coverSize>, pages: number, hasText: boolean): void {
  const ppi = 300;
  const { width, height } = coverPixels(c, ppi);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return;
  const css = (c3: number[]) => `rgb(${c3.map((v) => Math.round(v * 255)).join(",")})`;
  const px = (v: number) => v * ppi;
  for (const op of coverTemplate(c, hasText, templateLabels(c, pages))) {
    g.save();
    g.lineWidth = 2;
    if (op.k === "rect") {
      if (op.fill) {
        g.fillStyle = css(op.fill);
        g.fillRect(px(op.x), px(op.y), px(op.w), px(op.h));
      }
      if (op.stroke) {
        g.strokeStyle = css(op.stroke);
        g.setLineDash(op.dash ? [14, 10] : []);
        g.strokeRect(px(op.x), px(op.y), px(op.w), px(op.h));
      }
    } else if (op.k === "line") {
      g.strokeStyle = css(op.stroke);
      g.beginPath();
      g.moveTo(px(op.x1), px(op.y1));
      g.lineTo(px(op.x2), px(op.y2));
      g.stroke();
    } else {
      g.fillStyle = css(op.fill);
      g.font = `${(op.size / 72) * ppi}px Helvetica, Arial, sans-serif`;
      g.textAlign = op.anchor === "middle" ? "center" : "left";
      g.translate(px(op.x), px(op.y));
      if (op.rotate) g.rotate(Math.PI / 2);
      g.fillText(op.text, 0, 0);
    }
    g.restore();
  }
  canvas.toBlob((blob) => blob && download("kdp-cover-template.png", "image/png", blob), "image/png");
}

function toolCover(host: HTMLElement): void {
  const trim = selectField("trim", S.trim, trimOptions(), "6x9");
  const pages = numberField("pages", S.pages, 300, { min: 1, step: 1 });
  const ink = selectField("ink", S.paper, inkOptions(), "bw_white");
  mount(host, [trim.box, pages.box, ink.box], (out) => {
    const t = trimSpec(trim.input.value)!;
    const p = Number(pages.input.value);
    const i = ink.input.value as Ink;
    const msg = pagesMessage(t, i, p);
    if (msg) return void out.append(problem(msg));
    const c = coverSize(t, p, i);
    const px = coverPixels(c);
    const hasText = spineHasText(p);
    const rows: [string, string][] = [
      [S.coverWidth, inMm(c.width)],
      [S.coverHeight, inMm(c.height)],
      [S.spineWidth, inMm(c.spine)],
      [S.coverPx, `${px.width} × ${px.height} px`],
    ];
    const q = { trim: t.id, pages: p, ink: i };
    out.append(
      h("p", { class: "big", text: `${S.coverSize}: ${num(c.width)} × ${num(c.height)} ${S.in}` }),
      dl(rows),
      h(
        "table",
        { class: "panels" },
        h("thead", {}, h("tr", {}, h("th", { text: S.panel }), h("th", { text: S.coverWidth }))),
        h(
          "tbody",
          {},
          ...(
            [
              [S.back, `${inMm(c.bleed + c.trimWidth)} ${S.withBleed}`],
              [S.spine, inMm(c.spine)],
              [S.front, `${inMm(c.trimWidth + c.bleed)} ${S.withBleed}`],
            ] as [string, string][]
          ).map(([k, v]) => h("tr", {}, h("td", { text: k }), h("td", { text: v }))),
        ),
      ),
      h("p", { class: "buttons" }, button(S.downloadPdf, () => download("kdp-cover-template.pdf", "application/pdf", templatePdf(c.width, c.height, coverTemplate(c, hasText, templateLabels(c, p))) as Uint8Array<ArrayBuffer>)), button(S.downloadPng, () => drawPng(c, p, hasText))),
      links([
        [appLink(root, t.id, i), S.openApp],
        [`${root}${routePath(lang, "spine")}${query(q)}`, S.toSpine],
        [`${root}${routePath(lang, "cost")}${query(q)}`, S.toCost],
      ]),
      appHasTrim(t.id) ? h("p", { class: "tool-note", text: S.openAppNote }) : h("p", { class: "tool-note", text: S.noAppTrim }),
    );
  });
}

function toolCost(host: HTMLElement): void {
  const trim = selectField("trim", S.trim, trimOptions(), "6x9");
  const ink = selectField("ink", S.paper, inkOptions(), "bw_white");
  const pages = numberField("pages", S.pages, 300, { min: 1, step: 1 });
  const list = numberField("list", S.list, 14.99, { min: 0, step: 0.01 });
  mount(host, [trim.box, ink.box, pages.box, list.box], (out) => {
    const t = trimSpec(trim.input.value)!;
    const i = ink.input.value as Ink;
    const p = Number(pages.input.value);
    const msg = pagesMessage(t, i, p);
    if (msg) return void out.append(problem(msg));
    const cost = round(printingCost(t, i, p), 2);
    const min = minListPrice(printingCost(t, i, p));
    const price = Number(list.input.value);
    const band = FIGURES.printCost[i];
    const rate = t.large ? band.large : band.regular;
    const flat = p <= band.flatUpTo;
    const rows: [string, string][] = [
      [S.printingCost, money(cost)],
      [t.large ? S.costLarge : S.costRegular, fill(S.costBand, { ink: inkLabel[i], size: t.large ? S.large : S.regular, p, band: flat ? S.bandFlat : fill(S.bandPerPage, { fixed: money(rate.fixed), per: `$${num(rate.perPage, rate.perPage * 1000 % 1 === 0 ? 3 : 4)}` }) })],
      [S.minPrice, money(min)],
    ];
    out.append(h("p", { class: "big", text: `${S.printingCost}: ${money(cost)}` }), dl(rows));
    if (!Number.isFinite(price) || list.input.value === "") out.append(problem(S.needValue));
    else if (price < min) out.append(problem(S.belowMin));
    else if (price > FIGURES.royalty.maxList) out.append(problem(fill(S.aboveMax, { n: FIGURES.royalty.maxList })));
    else {
      const c = printingCost(t, i, p);
      out.append(dl([[S.royaltyRate, `${Math.round(royaltyRate(price) * 100)} %`], [S.royaltyPer, money(round(royalty(price, c), 2))], [S.royaltyExp, money(round(royalty(price, c, true), 2))]]));
    }
    const q = { trim: t.id, pages: p, ink: i };
    out.append(links([[`${root}${routePath(lang, "cover")}${query(q)}`, S.toCover], [`${root}${routePath(lang, "margins")}${query(q)}`, S.toMargins], [appLink(root, t.id, i), S.openApp]]));
  });
}

function toolMargins(host: HTMLElement): void {
  const trim = selectField("trim", S.trim, trimOptions(), "6x9");
  const pages = numberField("pages", S.pages, 300, { min: 1, step: 1 });
  const ink = selectField("ink", S.paper, inkOptions(), "bw_white");
  const bleed = checkField("bleed", S.bleed);
  mount(host, [trim.box, pages.box, ink.box, bleed.box], (out) => {
    const t = trimSpec(trim.input.value)!;
    const p = Number(pages.input.value);
    const i = ink.input.value as Ink;
    const msg = pagesMessage(t, i, p);
    if (msg) return void out.append(problem(msg));
    const m = margins(t, p, bleed.input.checked)!;
    const q = { trim: t.id, pages: p, ink: i };
    out.append(
      h("p", { class: "big", text: `${S.insideMargin}: ${inMm(m.inside)}` }),
      dl([
        [S.outsideMargin, inMm(m.outside)],
        [S.pageSize, `${num(m.pageWidth)} × ${num(m.pageHeight)} ${S.in}`],
        ["", bleed.input.checked ? S.pageSizeNote : S.pageSizeNoBleed],
        [S.textBlock, `${num(m.textWidth)} × ${num(m.textHeight)} ${S.in}`],
      ]),
      links([[`${root}${routePath(lang, "pages")}${query({ trim: t.id })}`, S.toPages], [`${root}${routePath(lang, "cover")}${query(q)}`, S.toCover], [appLink(root, t.id, i), S.openApp]]),
    );
  });
}

function toolTrim(host: HTMLElement): void {
  const kinds = Object.keys(S.genres) as (keyof Strings["genres"])[];
  const genre = selectField("genre", S.genre, kinds.map((k) => [k, S.genres[k]]), "novel");
  const ink = selectField("ink", S.paper, inkOptions(), "bw_white");
  const pages = numberField("pages", S.pages, 250, { min: 1, step: 1 });
  mount(host, [genre.box, ink.box, pages.box], (out) => {
    const i = ink.input.value as Ink;
    const p = Number(pages.input.value);
    if (!Number.isInteger(p) || p < 1) return void out.append(problem(S.badPages));
    const common = (genres as unknown as Record<string, string[]>)[genre.input.value] ?? [];
    const fitting = TRIM_SPECS.filter((t) => !pagesProblem(t, i, p));
    const row = (t: TrimSpec) => {
      const q = { trim: t.id, pages: p, ink: i };
      return h("li", {}, h("strong", { text: trimLabel(t) }), ` — ${t.large ? S.large : S.regular}; ${money(round(printingCost(t, i, p), 2))}. `, h("a", { href: `${root}${routePath(lang, "cost")}${query(q)}`, text: S.toCost }));
    };
    const main = common.map((id) => fitting.find((t) => t.id === id)).filter((t): t is TrimSpec => !!t);
    const rest = fitting.filter((t) => !main.includes(t));
    out.append(h("h2", { text: S.commonFor }), main.length ? h("ul", { class: "trims" }, ...main.map(row)) : problem(S.notSold), h("h2", { text: S.otherSizes }), h("ul", { class: "trims" }, ...rest.map(row)));
  });
}

function barcodePng(isbn13: string): void {
  const m = 6;
  const bars = barRuns(isbn13);
  const total = QUIET.left + MODULES + QUIET.right;
  const canvas = document.createElement("canvas");
  canvas.width = total * m;
  canvas.height = 74 * m;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  for (const b of bars) g.fillRect((QUIET.left + b.x) * m, 0, b.w * m, (b.x < 3 || (b.x >= 45 && b.x < 50) || b.x >= 92 ? 65 : 60) * m);
  g.font = `${9 * m}px Helvetica, Arial, sans-serif`;
  g.fillText(isbn13[0], (QUIET.left - 8) * m, 72 * m);
  g.fillText(isbn13.slice(1, 7).split("").join(" "), (QUIET.left + 4) * m, 72 * m);
  g.fillText(isbn13.slice(7).split("").join(" "), (QUIET.left + 51) * m, 72 * m);
  canvas.toBlob((blob) => blob && download(`isbn-${isbn13}.png`, "image/png", blob), "image/png");
}

function toolIsbn(host: HTMLElement): void {
  const id = uid("isbn");
  const input = h("input", { id, name: "isbn", type: "text", inputmode: "numeric", autocomplete: "off", value: params.get("isbn") ?? "978-1-86197-876-9" }) as HTMLInputElement;
  mount(host, [h("div", { class: "field" }, h("label", { for: id, text: S.isbn }), input)], (out) => {
    const r = checkIsbn(input.value);
    if (!r.ok) return void out.append(problem(r.reason === "format" ? S.isbnFormat : r.reason === "checksum" ? S.isbnChecksum : S.isbnPrefix));
    const ten = input.value.replace(/[\s-]/g, "").length === 10;
    const holder = h("div", { class: "barcode" });
    holder.innerHTML = "";
    const svg = new DOMParser().parseFromString(barcodeSvg(r.isbn13, 2), "image/svg+xml").documentElement;
    holder.append(document.importNode(svg, true));
    out.append(
      h("p", { class: "big", text: fill(ten ? S.isbnFromTen : S.isbnOk, { n: r.isbn13 }) }),
      h("h2", { text: S.barcode }),
      holder,
      h("p", { text: S.barcodeNote }),
      h("p", { class: "buttons" }, button(S.downloadSvg, () => download(`isbn-${r.isbn13}.svg`, "image/svg+xml", barcodeSvg(r.isbn13, 4))), button(S.downloadBarcodePng, () => barcodePng(r.isbn13))),
      links([[`${root}${routePath(lang, "cover")}`, S.toCover]]),
    );
  });
}

function toolPages(host: HTMLElement): void {
  const words = numberField("words", S.words, 80000, { min: 1, step: 1 });
  const trim = selectField("trim", S.trim, trimOptions(), "6x9");
  const font = selectField("font", S.font, ["10", "10.5", "11", "11.5", "12", "13"].map((v) => [v, v]), "11");
  const leading = selectField("leading", S.leading, ["1.2", "1.3", "1.4", "1.5"].map((v) => [v, v]), "1.3");
  const chapters = numberField("chapters", S.chapters, 25, { min: 0, step: 1 });
  const front = numberField("front", S.frontBack, 10, { min: 0, step: 1 });
  mount(host, [words.box, trim.box, font.box, leading.box, chapters.box, front.box], (out) => {
    const t = trimSpec(trim.input.value)!;
    const w = Number(words.input.value);
    if (!(w > 0)) return void out.append(problem(S.needWords));
    const r = wordsToPages({ words: w, trim: t, fontPt: Number(font.input.value), leading: Number(leading.input.value), chapters: Math.max(0, Number(chapters.input.value) || 0), frontBack: Math.max(0, Number(front.input.value) || 0) });
    if (!r) return void out.append(problem(S.needWords));
    const ink: Ink = "bw_white";
    const q = { trim: t.id, pages: r.pages, ink };
    out.append(
      h("p", { class: "big", text: `${S.estPages}: ${r.pages}` }),
      dl([
        [S.estWpp, String(r.wordsPerPage)],
        [S.spineWidth, inMm(spineWidth(r.pages, ink))],
        [S.insideMargin, insideMargin(r.pages) === null ? "—" : inMm(insideMargin(r.pages)!)],
      ]),
      h("p", { text: `${fill(S.estFont, { p: font.input.value, l: leading.input.value })}. ${S.estNote}` }),
      links([[`${root}${routePath(lang, "cost")}${query(q)}`, S.toCost], [`${root}${routePath(lang, "cover")}${query(q)}`, S.toCover], [appLink(root, t.id, ink), S.openApp]]),
    );
  });
}

const TOOLS: Record<string, (host: HTMLElement) => void> = { spine: toolSpine, cover: toolCover, cost: toolCost, margins: toolMargins, trim: toolTrim, isbn: toolIsbn, pages: toolPages };

const host = document.querySelector<HTMLElement>("[data-tool]");
const start = host && TOOLS[host.dataset.tool ?? ""];
if (host && start) start(host);

// Keep the page for offline use: the app's service worker also saves the tool pages as they are opened.
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register(`${root}sw.js`).catch(() => undefined);
