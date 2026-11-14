// The cover designer: a window with the whole flat cover on a canvas (with the printer's guides), a handle
// over each layer to pick it and move it with the mouse or the arrow keys, and a side panel to pick a
// template, edit texts and pictures, and see the checks live. Every change is a step that can be undone.
// The rules are in engine/cover/* and project/cover-ops.ts; this file only draws and listens.

import { clear, h } from "../app/dom";
import { getLocale, t } from "../app/ui-i18n";
import { exportCover, type Built } from "../app/pipeline";
import type { OutputFile } from "../app/host";
import { composeCover, type Cover } from "../engine/cover/cover";
import { parseCoverDesign, type CoverDesign, type CoverLayer, type ImageLayer, type PanelId, type TextLayer } from "../engine/cover/design";
import { layerBox } from "../engine/cover/render-design";
import { COVER_TEMPLATES, coverInfo, templateById } from "../engine/cover/templates";
import { coverTemplateAllowed, type Plan } from "../engine/entitlements";
import type { FontSet } from "../engine/fonts";
import { imageInfo } from "../engine/images";
import type { ImageAsset } from "../engine/model";
import { bookSlug } from "../engine/epub";
import { PagePainter } from "../preview/canvas";
import { ebookCoverJpeg, socialPng } from "./cover-export";
import { addImageLayer, addTextLayer, canRedo, canUndo, commit, layerById, layerName, moveLayer, patchLayer, redo, removeLayer, snapLayer, stackLayer, startHistory, undo, type CoverHistory, type SnapGuide } from "../project/cover-ops";
import { MAX_COVER_BYTES, setEbookCover, sniffImage } from "../project/cover-image";
import type { Project, ProjectAsset } from "../project/model";

export interface CoverEditorDeps {
  project(): Project | null;
  /** The designer made a new version of the project (a design and maybe new pictures). */
  change(next: Project): void;
  /** The book as last built and the fonts, or null when there is none yet. */
  base(): Promise<{ built: Built; fonts: FontSet } | null>;
  plan(): Plan;
  /** Save a file the person asked for; resolves to where it went, or null if they cancelled. */
  save(file: OutputFile): Promise<string | null>;
  notify(message: string): void;
  ask(d: { title: string; message: string; ok: string; cancel?: string }): Promise<"ok" | "cancel" | "extra">;
}

const PANELS: PanelId[] = ["front", "back", "spine"];
const SAVE_DELAY = 500;

export async function openCoverEditor(deps: CoverEditorDeps, opener?: HTMLElement): Promise<void> {
  const project = deps.project();
  const base = await deps.base();
  if (!project || !base) return deps.notify(t("export.openFirst"));
  new CoverEditor(deps, project, base.built, base.fonts, opener).open();
}

class CoverEditor {
  private dialog = h("dialog", { cls: "pub-dialog cv-dialog", attr: { "aria-labelledby": "cv-title" } });
  private canvas = h("canvas", { cls: "cv-canvas" });
  private stage = h("div", { cls: "cv-stage" });
  private handles = h("div", { cls: "cv-handles", attr: { role: "group", "aria-label": t("cv.title") } });
  private side = h("div", { cls: "cv-side" });
  private live = h("p", { cls: "sr-only", attr: { role: "status", "aria-live": "polite" } });
  private undoButton = h("button", { attr: { type: "button" }, text: t("cv.undo"), on: { click: () => this.stepBack() } });
  private redoButton = h("button", { attr: { type: "button" }, text: t("cv.redo"), on: { click: () => this.stepForward() } });
  private history: CoverHistory;
  private draft: CoverDesign | null = null;
  private selected: string | null = null;
  private variant = 1;
  private images: Map<string, ImageAsset>;
  private assets: ProjectAsset[];
  private painter: PagePainter;
  private cover: Cover | null = null;
  private guides: SnapGuide[] = [];
  private gen = 0;
  private timer = 0;
  private dirty = false;
  private removed = false;
  private ebook: Uint8Array | null = null;
  private resize: () => void;

  constructor(
    private deps: CoverEditorDeps,
    private project: Project,
    private built: Built,
    private fonts: FontSet,
    private opener?: HTMLElement,
  ) {
    this.images = new Map(built.book.images);
    this.assets = [...project.assets];
    this.painter = new PagePainter(fonts, this.images);
    this.history = startHistory(this.startDesign());
    this.resize = () => this.layoutCanvas();
  }

  private get design(): CoverDesign {
    return this.draft ?? this.history.present;
  }

  /** The saved design, or the first free template filled with this book's texts. */
  private startDesign(): CoverDesign {
    const g = composeCover(this.built.book, this.fonts, this.built.layout.pages.length).geometry;
    const saved = this.project.coverDesign;
    if (saved) return this.withPaths(parseCoverDesign(saved).design);
    return this.withPaths(COVER_TEMPLATES[0].build(coverInfo(this.built.book), g));
  }

  /** Point each picture layer at the vault path of its file (the project's Images folder). */
  private withPaths(d: CoverDesign): CoverDesign {
    const path = (target: string) => (this.images.has(`Images/${target}`) ? `Images/${target}` : [...this.images.keys()].find((k) => k.endsWith(`/${target}`)) ?? "");
    const background = d.background.kind === "image" ? { ...d.background, path: path(d.background.target) } : d.background;
    return { ...d, background, layers: d.layers.map((l) => (l.kind === "image" ? { ...l, path: path(l.target) } : l)) };
  }

  open(): void {
    const close = h("button", { cls: "mod-cta", text: t("cv.done"), attr: { type: "button" }, on: { click: () => this.dialog.close() } });
    const reset = h("button", { text: t("cv.reset"), attr: { type: "button" }, on: { click: () => void this.resetDesign() } });
    this.stage.append(this.canvas, this.handles);
    this.dialog.append(
      h("div", { cls: "cv-top" }, h("h2", { text: t("cv.title"), attr: { id: "cv-title" } }), h("div", { cls: "cv-bar" }, this.undoButton, this.redoButton, reset, close)),
      h("p", { cls: "cv-help", text: t("cv.handleHelp") }),
      h("div", { cls: "cv-body" }, h("div", { cls: "cv-main" }, this.stage), this.side),
      this.live,
    );
    this.dialog.addEventListener("close", () => this.closed());
    this.dialog.addEventListener("keydown", (ev) => this.keys(ev));
    window.addEventListener("resize", this.resize);
    document.body.appendChild(this.dialog);
    this.dialog.showModal();
    this.refresh();
  }

  private closed(): void {
    window.removeEventListener("resize", this.resize);
    window.clearTimeout(this.timer);
    this.commitDraft();
    if (this.dirty) this.save();
    this.painter.dispose();
    this.dialog.remove();
    this.opener?.focus();
  }

  // ── Steps ──

  private setDraft(d: CoverDesign): void {
    this.draft = d;
    this.refresh(false);
  }

  private commitDraft(): void {
    if (!this.draft) return;
    const next = this.draft;
    this.draft = null;
    const before = this.history;
    this.history = commit(this.history, next);
    if (this.history !== before) this.changed();
  }

  private apply(d: CoverDesign): void {
    this.draft = d;
    this.commitDraft();
    this.refresh();
  }

  private stepBack(): void {
    this.commitDraft();
    this.history = undo(this.history);
    this.changed();
    this.refresh();
    this.say(t("cv.undo"));
  }

  private stepForward(): void {
    this.commitDraft();
    this.history = redo(this.history);
    this.changed();
    this.refresh();
    this.say(t("cv.redo"));
  }

  private changed(): void {
    this.dirty = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.save(), SAVE_DELAY);
  }

  private save(): void {
    window.clearTimeout(this.timer);
    this.dirty = false;
    const keep = this.removed ? undefined : this.history.present;
    const stripped = keep ? parseCoverDesign(keep).design : undefined;
    const base = this.deps.project() ?? this.project;
    let next: Project = { ...base, assets: this.assets, updatedAt: Date.now() };
    if (stripped) next.coverDesign = stripped;
    else delete next.coverDesign;
    if (this.ebook) next = setEbookCover(next, this.ebook, Date.now());
    this.deps.change(next);
  }

  private say(message: string): void {
    this.live.textContent = message;
  }

  private async resetDesign(): Promise<void> {
    const ok = await this.deps.ask({ title: t("cv.reset"), message: t("cv.resetAsk"), ok: t("cv.resetOk"), cancel: t("proj.cancel") });
    if (ok !== "ok") return;
    this.removed = true;
    this.dirty = true;
    this.save();
    this.deps.notify(t("cv.reseted"));
    this.dialog.close();
  }

  private keys(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if ((ev.ctrlKey || ev.metaKey) && !typing) {
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) {
        ev.preventDefault();
        this.stepBack();
      } else if (k === "y" || (k === "z" && ev.shiftKey)) {
        ev.preventDefault();
        this.stepForward();
      }
    }
  }

  // ── Drawing ──

  /** Make the cover from the current design and redraw everything; `panel` false leaves the side panel alone (typing in it). */
  private refresh(panel = true): void {
    const design = this.design;
    const book = { ...this.built.book, images: this.images, meta: { ...this.built.book.meta, coverLayout: design } };
    this.cover = composeCover(book, this.fonts, this.built.layout.pages.length, { guides: true });
    this.undoButton.disabled = !canUndo(this.history) && !this.draft;
    this.redoButton.disabled = !canRedo(this.history);
    this.layoutCanvas();
    this.drawHandles();
    this.drawChecks();
    if (panel) this.drawSide();
  }

  private layoutCanvas(): void {
    const cover = this.cover;
    if (!cover) return;
    const main = this.stage.parentElement;
    const width = Math.max(Math.min((main?.clientWidth || 800) - 4, 1100), 280);
    const scale = width / cover.layout.widthPt;
    this.stage.style.width = `${Math.round(width)}px`;
    this.stage.style.height = `${Math.round(cover.layout.heightPt * scale)}px`;
    this.canvas.setAttribute("role", "img");
    const g = cover.geometry;
    this.canvas.setAttribute("aria-label", t("cv.canvas", { width: g.width.toFixed(2), height: g.height.toFixed(2) }));
    const gen = ++this.gen;
    void this.painter.paint(this.canvas, cover.layout, cover.layout.pages[0], { scale, dpr: Math.min(window.devicePixelRatio || 1, 2), paper: "#ffffff" }).then(() => {
      if (gen !== this.gen) return;
      this.canvas.dataset.ready = String(gen);
    });
  }

  private drawHandles(): void {
    const cover = this.cover;
    if (!cover) return;
    const g = cover.geometry;
    const keepFocus = document.activeElement instanceof HTMLElement && this.handles.contains(document.activeElement) ? document.activeElement.dataset.layer : null;
    clear(this.handles);
    for (const l of this.design.layers) {
      const b = layerBox(g, l);
      // Rules and frame lines are too thin to aim at; they are still in the layer list.
      if (Math.min(b.w / g.width, b.h / g.height) < 0.012) continue;
      const button = h("button", {
        cls: ["cv-handle", `cv-${l.kind}`, l.id === this.selected && "is-selected"],
        attr: { type: "button", "data-layer": l.id, "aria-pressed": l.id === this.selected, "aria-label": t("cv.handle", { kind: t(`cv.kind.${l.kind}`), panel: t(`cv.panel.${l.panel}`), name: layerName(l) }) },
        on: {
          click: () => this.select(l.id),
          keydown: (ev) => this.handleKey(ev, l.id),
          pointerdown: (ev) => this.drag(ev, l.id),
        },
      });
      Object.assign(button.style, { left: `${(b.x / g.width) * 100}%`, top: `${(b.y / g.height) * 100}%`, width: `${(b.w / g.width) * 100}%`, height: `${(b.h / g.height) * 100}%` });
      this.handles.appendChild(button);
    }
    for (const guide of this.guides) {
      const panel = guide.panel === "back" ? g.back : guide.panel === "spine" ? g.spineBox : g.front;
      const line = h("div", { cls: `cv-guide cv-guide-${guide.axis}`, attr: { "aria-hidden": true } });
      if (guide.axis === "x") Object.assign(line.style, { left: `${((panel.x + guide.at * panel.w) / g.width) * 100}%`, top: "0", height: "100%" });
      else Object.assign(line.style, { top: `${((panel.y + guide.at * panel.h) / g.height) * 100}%`, left: "0", width: "100%" });
      this.handles.appendChild(line);
    }
    if (keepFocus) this.handles.querySelector<HTMLElement>(`[data-layer="${CSS.escape(keepFocus)}"]`)?.focus();
  }

  private drawChecks(): void {
    let box = this.side.querySelector<HTMLElement>(".cv-checks");
    if (!box) return;
    clear(box);
    const found = (this.cover?.findings ?? []).filter((f) => f.severity !== "info" || f.layer);
    if (!found.length) return void box.appendChild(h("p", { text: t("cv.allGood") }));
    const ul = h("ul", { cls: "bs-problems" });
    for (const f of found) {
      const li = h("li", { cls: `is-${f.severity}` }, f.message);
      if (f.layer && layerById(this.design, f.layer)) li.append(" ", h("button", { cls: "cv-link", text: layerName(layerById(this.design, f.layer)!), attr: { type: "button" }, on: { click: () => this.select(f.layer!) } }));
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  // ── Pointer and keys ──

  private select(id: string | null): void {
    this.selected = id;
    this.drawHandles();
    this.drawSide();
    if (id) this.handles.querySelector<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`)?.focus();
  }

  private handleKey(ev: KeyboardEvent, id: string): void {
    const step = ev.shiftKey ? 0.02 : 0.005;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (ev.key in move && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      this.selected = id;
      const [dx, dy] = move[ev.key];
      const moved = moveLayer(this.design, id, dx, dy);
      this.apply(this.snapped(moved, id));
      this.say(t("cv.moved", { name: layerName(layerById(moved, id)!) }));
      this.handles.querySelector<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`)?.focus();
    } else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      this.removeSelected(id);
    }
  }

  private snapped(d: CoverDesign, id: string): CoverDesign {
    if (!this.cover) return d;
    const r = snapLayer(d, id, this.cover.geometry);
    this.guides = r.guides;
    window.setTimeout(() => {
      this.guides = [];
      this.drawHandles();
    }, 600);
    return r.design;
  }

  private drag(ev: PointerEvent, id: string): void {
    const layer = layerById(this.design, id);
    const cover = this.cover;
    if (!layer || !cover || ev.button !== 0) return;
    const g = cover.geometry;
    const panel = layer.panel === "back" ? g.back : layer.panel === "spine" ? g.spineBox : g.front;
    const rect = this.stage.getBoundingClientRect();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const origin = this.design;
    let moved = false;
    this.selected = id;
    const onMove = (m: PointerEvent) => {
      const dx = ((m.clientX - startX) / rect.width) * (g.width / panel.w);
      const dy = ((m.clientY - startY) / rect.height) * (g.height / panel.h);
      if (!moved && Math.hypot(m.clientX - startX, m.clientY - startY) < 4) return;
      moved = true;
      this.setDraft(this.snapped(moveLayer(origin, id, dx, dy), id));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (moved) {
        this.commitDraft();
        this.refresh();
      } else this.select(id);
    };
    // The handles are drawn again on every step of a drag, so listen on the window, not on one of them.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  private removeSelected(id: string): void {
    this.apply(removeLayer(this.design, id));
    this.selected = null;
    this.drawHandles();
    this.drawSide();
    this.say(t("cv.removed"));
  }

  // ── Side panel ──

  private drawSide(): void {
    clear(this.side);
    const d = this.design;
    const plan = this.deps.plan();

    // Template
    const select = h("select", { attr: { id: "cv-template" } });
    const group = (label: string, pro: boolean) => {
      const og = h("optgroup", { attr: { label } });
      for (const tpl of COVER_TEMPLATES.filter((x) => x.pro === pro)) og.appendChild(h("option", { attr: { value: tpl.id, selected: d.template === tpl.id }, text: tplName(tpl.id) }));
      select.appendChild(og);
    };
    group(t("cv.templateFree"), false);
    group(t("cv.templatePro"), true);
    if (!d.template || !templateById(d.template)) select.insertBefore(h("option", { attr: { value: "", selected: true }, text: "—" }), select.firstChild);
    select.addEventListener("change", () => this.pickTemplate(select.value, select));
    const tpl = d.template ? templateById(d.template) : undefined;
    const variant = tpl?.generative ? h("button", { text: t("cv.variant"), attr: { type: "button" }, on: { click: () => this.nextVariant() } }) : null;
    const bg = h("input", { attr: { type: "color", id: "cv-bg", value: d.background.color } });
    bg.addEventListener("input", () => this.setDraft({ ...this.design, background: { ...this.design.background, color: bg.value } }));
    bg.addEventListener("change", () => (this.commitDraft(), this.refresh(false)));
    this.side.append(
      h("section", { cls: "cv-sec" }, h("label", { attr: { for: "cv-template" }, text: t("cv.template") }), select, variant, h("label", { attr: { for: "cv-bg" }, text: t("cv.background") }), bg),
    );
    void plan;

    // Layers
    const list = h("ul", { cls: "cv-layers" });
    for (const l of [...d.layers].reverse()) {
      list.appendChild(
        h("li", null, h("button", { cls: l.id === this.selected ? "is-selected" : "", attr: { type: "button", "aria-pressed": l.id === this.selected }, text: `${t(`cv.panel.${l.panel}`)} · ${t(`cv.kind.${l.kind}`)} · ${layerName(l)}`, on: { click: () => this.select(l.id) } })),
      );
    }
    const where = h("select", { attr: { id: "cv-where", "aria-label": t("cv.addTo") } }, ...PANELS.map((p) => h("option", { attr: { value: p }, text: t(`cv.panel.${p}`) })));
    const file = h("input", { attr: { type: "file", accept: "image/png,image/jpeg", id: "cv-file", "aria-label": t("cv.picture"), tabindex: -1 }, cls: "sr-only" });
    file.addEventListener("change", () => void this.addPicture(file, where.value as PanelId));
    this.side.append(
      h(
        "section",
        { cls: "cv-sec" },
        h("h3", { text: t("cv.layers") }),
        list,
        h("div", { cls: "cv-add" }, where, h("button", { text: t("cv.addText"), attr: { type: "button", id: "cv-add-text" }, on: { click: () => this.addText(where.value as PanelId) } }), h("button", { text: t("cv.addPicture"), attr: { type: "button", id: "cv-add-picture" }, on: { click: () => file.click() } })),
        file,
      ),
    );

    // Back cover and files
    const barcode = h("select", { attr: { id: "cv-barcode" } }, h("option", { attr: { value: "isbn", selected: d.barcode !== "blank" }, text: t("cv.barcode.isbn") }), h("option", { attr: { value: "blank", selected: d.barcode === "blank" }, text: t("cv.barcode.blank") }));
    barcode.addEventListener("change", () => this.apply({ ...this.design, barcode: barcode.value === "blank" ? "blank" : undefined }));
    const fileButton = (id: string, key: "cv.pdf" | "cv.jpg" | "cv.png" | "cv.ebook", kind: "pdf" | "jpg" | "png" | "ebook") => h("button", { text: t(key), attr: { type: "button", id }, on: { click: () => void this.makeFile(kind) } });
    this.side.append(
      h(
        "section",
        { cls: "cv-sec" },
        h("h3", { text: t("cv.files") }),
        h("p", { cls: "cv-note", text: t("cv.backHelp") }),
        h("label", { attr: { for: "cv-barcode" }, text: t("cv.barcode") }),
        barcode,
        h("div", { cls: "cv-files" }, fileButton("cv-pdf", "cv.pdf", "pdf"), fileButton("cv-jpg", "cv.jpg", "jpg"), fileButton("cv-png", "cv.png", "png"), fileButton("cv-ebook", "cv.ebook", "ebook")),
      ),
    );

    // Selected layer
    const sel = this.selected ? layerById(d, this.selected) : undefined;
    this.side.append(h("section", { cls: "cv-sec cv-props" }, h("h3", { text: t("cv.selected") }), ...(sel ? this.props(sel) : [h("p", { text: t("cv.none") })])));
    this.side.append(h("section", { cls: "cv-sec" }, h("h3", { text: t("cv.checks") }), h("div", { cls: "cv-checks", attr: { "aria-live": "polite" } })));
    this.drawChecks();
  }

  private props(l: CoverLayer): HTMLElement[] {
    const out: HTMLElement[] = [];
    const field = (id: string, label: string, control: HTMLElement) => h("div", { cls: "cv-field" }, h("label", { attr: { for: id }, text: label }), control);
    const live = <E extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(el: E, patch: (v: string) => Partial<TextLayer> | Partial<ImageLayer>) => {
      const run = () => this.setDraft(patchLayer(this.design, l.id, patch(el.value)));
      el.addEventListener("input", run);
      el.addEventListener("change", () => {
        run();
        this.commitDraft();
        this.refresh(false);
      });
      return el;
    };
    if (l.kind === "text") {
      out.push(field("cv-text", t("cv.text"), live(h("textarea", { attr: { id: "cv-text", rows: 4 } }, l.text), (v) => ({ text: v }))));
      out.push(field("cv-size", t("cv.size"), live(h("input", { attr: { id: "cv-size", type: "number", min: 4, max: 200, step: 1, value: Math.round(l.size) } }), (v) => ({ size: Number(v) || l.size, minSize: Math.min(l.minSize ?? l.size, Number(v) || l.size) }))));
      out.push(field("cv-color", t("cv.color"), live(h("input", { attr: { id: "cv-color", type: "color", value: l.color } }), (v) => ({ color: v }))));
      const align = h("select", { attr: { id: "cv-align" } }, ...(["left", "center", "right"] as const).map((a) => h("option", { attr: { value: a, selected: a === l.align }, text: t(`cv.${a}`) })));
      out.push(field("cv-align", t("cv.align"), live(align, (v) => ({ align: v as TextLayer["align"] }))));
    } else if (l.kind === "rect") {
      out.push(field("cv-color", t("cv.color"), live(h("input", { attr: { id: "cv-color", type: "color", value: l.color } }), (v) => ({ color: v }))));
    } else {
      const range = (id: string, label: string, min: number, max: number, step: number, value: number, key: "zoom" | "focusX" | "focusY" | "dim") =>
        out.push(field(id, label, live(h("input", { attr: { id, type: "range", min, max, step, value } }), (v) => ({ [key]: Number(v) }))));
      range("cv-zoom", t("cv.zoom"), 1, 4, 0.05, l.zoom ?? 1, "zoom");
      range("cv-fx", t("cv.focusX"), 0, 1, 0.01, l.focusX ?? 0.5, "focusX");
      range("cv-fy", t("cv.focusY"), 0, 1, 0.01, l.focusY ?? 0.5, "focusY");
      range("cv-dim", t("cv.dim"), -0.8, 0.8, 0.05, l.dim ?? 0, "dim");
    }
    const row = h(
      "div",
      { cls: "cv-add" },
      h("button", { text: t("cv.forward"), attr: { type: "button" }, on: { click: () => (this.apply(stackLayer(this.design, l.id, 1)), this.drawHandles()) } }),
      h("button", { text: t("cv.backward"), attr: { type: "button" }, on: { click: () => (this.apply(stackLayer(this.design, l.id, -1)), this.drawHandles()) } }),
      h("button", { text: t("cv.remove"), attr: { type: "button" }, on: { click: () => this.removeSelected(l.id) } }),
    );
    out.push(row);
    return out;
  }

  // ── Actions ──

  private pickTemplate(id: string, select: HTMLSelectElement): void {
    const tpl = templateById(id);
    if (!tpl || !this.cover) return;
    if (!coverTemplateAllowed(this.deps.plan(), id)) {
      this.deps.notify(t("cv.proOnly", { name: tplName(id) }));
      select.value = this.design.template ?? "";
      return;
    }
    this.variant = 1;
    this.apply(this.withPaths(tpl.build(coverInfo(this.built.book, this.variant), this.cover.geometry)));
    this.selected = null;
    this.drawSide();
    this.say(t("cv.templateApplied", { name: tplName(id) }));
  }

  private nextVariant(): void {
    const tpl = this.design.template ? templateById(this.design.template) : undefined;
    if (!tpl || !this.cover) return;
    this.variant++;
    this.apply(this.withPaths(tpl.build(coverInfo(this.built.book, this.variant), this.cover.geometry)));
  }

  private addText(panel: PanelId): void {
    const ink = this.design.background.color;
    const color = parseInt(ink.slice(1, 3), 16) * 0.3 + parseInt(ink.slice(3, 5), 16) * 0.59 + parseInt(ink.slice(5, 7), 16) * 0.11 > 140 ? "#111111" : "#ffffff";
    const r = addTextLayer(this.design, panel, t("cv.newText"), color);
    this.apply(r.design);
    this.select(r.id);
  }

  /** The cover as it will print (no guides), from the design as it is now. */
  private finalBook() {
    this.commitDraft();
    return { ...this.built.book, images: this.images, meta: { ...this.built.book.meta, coverLayout: this.history.present } };
  }

  private async makeFile(kind: "pdf" | "jpg" | "png" | "ebook"): Promise<void> {
    try {
      const book = this.finalBook();
      const slug = bookSlug(book);
      if (kind === "pdf") {
        const out = await exportCover({ ...this.built, book }, this.fonts);
        return this.saved(await this.deps.save({ name: out.name, mime: "application/pdf", data: out.data }));
      }
      const cover = composeCover(book, this.fonts, this.built.layout.pages.length);
      if (kind === "png") return this.saved(await this.deps.save({ name: `${slug}-social.png`, mime: "image/png", data: await socialPng(cover, this.painter, this.history.present.background.color) }));
      const jpg = await ebookCoverJpeg(cover, this.painter);
      if (kind === "jpg") return this.saved(await this.deps.save({ name: `${slug}-front-cover.jpg`, mime: "image/jpeg", data: jpg }));
      this.ebook = jpg;
      this.dirty = true;
      this.save();
      this.deps.notify(t("cv.ebookDone"));
      this.say(t("cv.ebookDone"));
    } catch (e) {
      this.deps.notify(t("cv.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  private saved(where: string | null): void {
    if (where) this.deps.notify(t("cv.saved", { where }));
  }

  private async addPicture(input: HTMLInputElement, panel: PanelId): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImage(bytes);
    if (!mime) return this.deps.notify(t("cv.pictureBad"));
    if (bytes.length > MAX_COVER_BYTES) return this.deps.notify(t("cv.pictureBig", { mb: (bytes.length / 1048576).toFixed(1), max: MAX_COVER_BYTES / 1048576 }));
    let n = 1;
    const ext = mime === "image/png" ? "png" : "jpg";
    while (this.assets.some((a) => a.name === `cover-art-${n}.${ext}`)) n++;
    const name = `cover-art-${n}.${ext}`;
    const path = `Images/${name}`;
    const info = imageInfo(path, bytes);
    if (!info) return this.deps.notify(t("cv.pictureBad"));
    this.assets.push({ name, mime, data: bytes });
    this.images.set(path, info);
    const r = addImageLayer(this.design, panel, name, path, "");
    this.apply(r.design);
    this.select(r.id);
    this.deps.notify(t("cv.pictureAdded"));
  }
}

const tplName = (id: string): string => {
  const tpl = templateById(id);
  if (!tpl) return id;
  return getLocale() === "es" ? tpl.nameEs : tpl.name;
};
