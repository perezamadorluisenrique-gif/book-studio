// A small element builder shared by the Obsidian view and the web app. It never
// parses HTML: text goes in as text nodes, so note content can't inject markup.

type Child = Node | string | number | null | undefined | false;

export interface Props {
  cls?: string | (string | false | null | undefined)[];
  text?: string;
  attr?: Record<string, string | number | boolean | null | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

type Factory = <K extends keyof HTMLElementTagNameMap>(tag: K) => HTMLElementTagNameMap[K];

let factory: Factory | null = null;

/** Each host says how to make elements: Obsidian's createEl, or the DOM API on the web. */
export function setElementFactory(make: Factory): void {
  factory = make;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  if (!factory) throw new Error("setElementFactory() must be called before building UI.");
  const el = factory(tag);
  if (props) {
    const cls = Array.isArray(props.cls) ? props.cls.filter(Boolean).join(" ") : props.cls;
    if (cls) el.className = cls;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attr) {
      for (const [k, v] of Object.entries(props.attr)) {
        if (v === false || v === null || v === undefined) continue;
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (props.on) {
      for (const [type, fn] of Object.entries(props.on)) el.addEventListener(type, fn as EventListener);
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A <select> with options; `badge` marks options the plan doesn't include. */
export function select(options: { value: string; label: string; badge?: string }[], value: string, props: Props = {}): HTMLSelectElement {
  const s = h("select", props, ...options.map((o) => h("option", { attr: { value: o.value, selected: o.value === value } }, o.badge ? `${o.label} (${o.badge})` : o.label)));
  s.value = value;
  return s;
}

export const nextFrame = () => new Promise<void>((r) => window.requestAnimationFrame(() => window.setTimeout(r, 0)));
