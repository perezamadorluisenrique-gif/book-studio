import { beforeAll, describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import type { FontSet } from "../src/engine/fonts";
import type { Layout } from "../src/engine/layout/index";
import type { Inline } from "../src/engine/model";
import { smartenInlines, smartenText } from "../src/engine/typography";
import { fsVault } from "./helpers/fsVault";
import { memVault } from "./helpers/memVault";
import { layoutHyphenated } from "./helpers/layout";
import { testFonts } from "./helpers/fonts";

const NB = " ";
const t = (text: string): Inline[] => [{ kind: "text", text, style: {} }];
const es = (text: string): string => smartenInlines(t(text), "es").map((i) => (i.kind === "text" ? i.text : "")).join("");

describe("Spanish orthotypography", () => {
  it("sets the dash of dialogue against the word", () => {
    expect(es("- Hola, dijo.")).toBe("—Hola, dijo.");
    expect(es("-- Hola")).toBe("—Hola");
    expect(es("— Hola")).toBe("—Hola");
    expect(es("Sin guion -- aquí")).toBe("Sin guion – aquí");
  });

  it("glues titles, numbers, units and references with a no-break space", () => {
    expect(es("El Sr. López y la Dra. Ruiz")).toBe(`El Sr.${NB}López y la Dra.${NB}Ruiz`);
    expect(es("Corrió 20 km y pagó 10 € (5 %).")).toBe(`Corrió 20${NB}km y pagó 10${NB}€ (5${NB}%).`);
    expect(es("Véase pág. 12, cap. 3 y n.º 4.")).toBe(`Véase pág.${NB}12, cap.${NB}3 y n.º${NB}4.`);
    expect(es("Hasta el siglo XIX.")).toBe(`Hasta el siglo${NB}xix.`);
    expect(es("Dijo p. ej. algo")).toBe("Dijo p. ej. algo");
  });

  it("marks Roman numerals after 'siglo' as small capitals and leaves other capitals alone", () => {
    const out = smartenInlines(t("En el siglo XV y XVI vivió DON JUAN."), "es");
    const caps = out.filter((i) => i.kind === "text" && i.style.smallCaps).map((i) => (i.kind === "text" ? i.text : ""));
    expect(caps).toEqual(["xv", "xvi"]);
    expect(out.map((i) => (i.kind === "text" ? i.text : "")).join("")).toContain("DON JUAN");
  });

  it("sets ellipses", () => {
    expect(smartenText("Bueno... no.... sí", "es")).toBe("Bueno… no…. sí");
  });

  it("nests quotes: inner doubles and singles inside guillemets", () => {
    expect(es('Dijo "él me dijo \\"hola\\" ayer" y se fue.'.replace(/\\"/g, '"'))).toBe("Dijo «él me dijo “hola” ayer» y se fue.");
    expect(es("Dijo «él me dijo 'hola' ayer».")).toBe("Dijo «él me dijo ‘hola’ ayer».");
  });

  it("does not touch English text", () => {
    expect(smartenInlines(t("Mr. Smith ran 20 km."), "en").map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe(`Mr.${NB}Smith ran 20${NB}km.`);
  });
});

describe("dialogue lines", { timeout: 30_000 }, () => {
  let fonts: FontSet;
  beforeAll(async () => {
    fonts = await testFonts();
  });

  it("never starts or ends a line on a loose dash in dialogo-es", async () => {
    const vault = fsVault(new URL("./fixtures/books/dialogo-es", import.meta.url).pathname);
    const layout = await layoutHyphenated(await loadBook(vault, "Marianela (muestra).md"), fonts);
    expect(loose(layout)).toEqual([]);
  });

  it("keeps the incise dash with its word in a synthetic dialogue", async () => {
    const line = "—Cuando llegué a casa —dijo Marianela con voz cansada— ya no quedaba nadie —añadió el viejo— y nos fuimos todos.";
    const body = Array.from({ length: 60 }, (_, k) => `${line} ${"palabra ".repeat(k % 7)}`.trim()).join("\n\n");
    const vault = memVault({ "Book.md": "---\nbook: true\ntitle: T\nlanguage: es\n---\n- [[One]]\n", "One.md": `# One\n\n${body}` });
    const layout = await layoutHyphenated(await loadBook(vault, "Book.md"), fonts);
    expect(loose(layout)).toEqual([]);
  });
});

function loose(layout: Layout): string[] {
  {
    const bad: string[] = [];
    for (const page of layout.pages) {
      const rows = new Map<number, string[]>();
      for (const d of page.draws) if (d.kind === "text") rows.set(d.y, [...(rows.get(d.y) ?? []), d.text]);
      for (const parts of rows.values()) {
        const line = parts.join("").trim();
        if (/(^|\s)[—–]$/.test(line)) bad.push(line);
        if (/^[—–]\s*$/.test(line)) bad.push(line);
      }
    }
    return bad;
  }
}
