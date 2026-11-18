/// <reference types="node" />
import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportPdf } from "../src/app/pipeline";
import { auditBook } from "../src/engine/a11y";
import { DIAGRAM_PPI, MAX_DIAGRAM_PIXELS, diagramAlt, diagramScale, diagramText, errorText, forPrint, isDiagram, sizedSvg, svgSize, type DiagramRenderer } from "../src/engine/diagrams";
import { writeEpub } from "../src/engine/epub";
import type { FontSet } from "../src/engine/fonts";
import type { Block } from "../src/engine/model";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";

let fonts: FontSet;
beforeAll(async () => {
  fonts = await testFonts();
});

/** A real, white RGB PNG, so the PDF writer can embed it. */
function whitePng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3, 0xff);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** Stands in for Mermaid: "graph" code draws a box of the size given in a `%% size WxH` comment; anything else fails like a parse error. */
function fakeRenderer(): { render: DiagramRenderer; calls: string[] } {
  const calls: string[] = [];
  const render: DiagramRenderer = async (code, req) => {
    calls.push(code);
    if (!/^\s*graph\b/m.test(code)) throw new Error("Parse error on line 1:\nflowchat TD\n^\nExpecting 'GRAPH', got 'NODE_STRING'");
    const [w, h] = (/%% size (\d+)x(\d+)/.exec(code)?.slice(1) ?? ["200", "100"]).map(Number);
    const scale = diagramScale(w, h, req.maxPrintInches);
    return { png: whitePng(Math.round(w * scale), Math.round(h * scale)), width: w, height: h, scale };
  };
  return { render, calls };
}

const para = "A line of the story that goes on for a while, as stories do, with a comma here and a clause there. ".repeat(6);
const fence = (code: string) => "```mermaid\n" + code + "\n```";
const described = "graph TD\n  accTitle: Order flow\n  accDescr: An order goes from the cart to payment to shipping.\n  A[Cart] --> B[Pay] --> C[Ship]";

function vault(one: string) {
  return memVault({
    "Book.md": `---\nbook: true\ntitle: Diagram Book\nauthor: Ada Writer\n---\n## Chapters\n1. [[One]]\n`,
    "One.md": `# One\n\n${para}\n\n${one}\n\n${para}\n`,
  });
}

function flat(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => (b.kind === "blockquote" ? [b, ...flat(b.blocks)] : b.kind === "list" ? [b, ...b.items.flatMap(flat)] : [b]));
}

describe("Mermaid helpers", () => {
  it("recognises the mermaid fence, whatever its case or extra words", () => {
    expect(isDiagram("mermaid")).toBe(true);
    expect(isDiagram("Mermaid title=x")).toBe(true);
    expect(isDiagram("js")).toBe(false);
    expect(isDiagram("")).toBe(false);
    expect(isDiagram(undefined)).toBe(false);
  });

  it("reads accTitle and accDescr, on one line or in a block", () => {
    expect(diagramText("graph TD\n accTitle: Flow \n accDescr: Steps in order\nA-->B")).toEqual({ title: "Flow", description: "Steps in order" });
    expect(diagramText("graph TD\naccDescr {\n  First line\n  second line\n}\nA-->B")).toEqual({ description: "First line second line" });
    expect(diagramText("graph TD\nA-->B")).toEqual({});
    expect(diagramText("graph TD\naccTitle:   \nA-->B")).toEqual({});
  });

  it("joins title and description into one alt text", () => {
    expect(diagramAlt(described)).toBe("Order flow. An order goes from the cart to payment to shipping.");
    expect(diagramAlt("graph TD\naccTitle: Done?\naccDescr: Yes")).toBe("Done? Yes");
    expect(diagramAlt("graph TD\naccDescr: Only this")).toBe("Only this");
    expect(diagramAlt("graph TD\nA-->B")).toBe("");
  });

  it("puts the print settings first, or right after front matter", () => {
    const plainCode = forPrint("graph TD\nA-->B");
    expect(plainCode.split("\n")[0]).toMatch(/^%%\{init: .*"theme": "neutral".*"htmlLabels": false.*\}%%$/);
    expect(plainCode.endsWith("graph TD\nA-->B")).toBe(true);
    const withFm = forPrint("---\ntitle: Flow\n---\ngraph TD\nA-->B");
    expect(withFm.startsWith("---\ntitle: Flow\n---\n%%{init:")).toBe(true);
    expect(withFm.endsWith("\ngraph TD\nA-->B")).toBe(true);
  });

  it("draws small diagrams at 300 ppi or more at their own size", () => {
    const s = diagramScale(200, 100, 6);
    expect(s * 96).toBeGreaterThanOrEqual(DIAGRAM_PPI);
  });

  it("draws wide diagrams sharp enough for the widest page, not wider", () => {
    const s = diagramScale(1000, 400, 6);
    expect(1000 * s).toBeGreaterThanOrEqual(6 * DIAGRAM_PPI);
    expect(1000 * s).toBeLessThan(6 * DIAGRAM_PPI * 1.1);
    // Already that sharp: never drawn smaller than Mermaid made it.
    expect(diagramScale(4000, 400, 6)).toBe(1);
  });

  it("keeps huge diagrams within what a canvas can hold", () => {
    const s = diagramScale(3000, 9000, 8.5);
    expect(3000 * s * 9000 * s).toBeLessThanOrEqual(MAX_DIAGRAM_PIXELS);
    expect(9000 * s).toBeLessThanOrEqual(16_384);
    expect(diagramScale(0, 100, 6)).toBe(1);
    expect(diagramScale(Number.NaN, 100, 6)).toBe(1);
  });

  it("reads the SVG size from the viewBox, else width and height", () => {
    const svg = `<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 212.5px;" viewBox="-8 -8 212.5 118" role="graphics-document document"><g/></svg>`;
    expect(svgSize(svg)).toEqual({ width: 212.5, height: 118 });
    expect(svgSize(`<svg width="40px" height="30"></svg>`)).toEqual({ width: 40, height: 30 });
    expect(svgSize(`<svg width="100%"></svg>`)).toBeNull();
    expect(svgSize("not svg")).toBeNull();
  });

  it("fixes the root size and drops Mermaid's max-width style", () => {
    const svg = `<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 212.5px;" viewBox="0 0 212.5 118"><style>#m1{fill:red}</style><rect width="10" height="10"/></svg>`;
    const out = sizedSvg(svg, 212.5, 118);
    expect(out.startsWith(`<svg width="212.5" height="118" id="m1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 212.5 118">`)).toBe(true);
    expect(out).toContain(`<rect width="10" height="10"/>`);
    expect(out).toContain("<style>#m1{fill:red}</style>");
  });

  it("shortens Mermaid errors to one line without the caret", () => {
    expect(errorText(new Error("Parse error on line 2:\n...A-->\n-----^\nExpecting 'NODE'"))).toBe("Parse error on line 2: ...A--> Expecting 'NODE'");
    expect(errorText(new Error("x".repeat(400))).length).toBe(300);
    expect(errorText(null)).toBe("unknown error");
    expect(errorText("plain")).toBe("plain");
  });
});

describe("Mermaid diagrams in a book", () => {
  it("stays a code block when the host draws no diagrams", async () => {
    const built = await buildBook(vault(fence(described)), "Book.md", fonts);
    const code = built.book.chapters[0].blocks.find((b) => b.kind === "code");
    expect(code).toMatchObject({ kind: "code", lang: "mermaid" });
    expect(built.book.warnings.filter((w) => /Mermaid/.test(w.message))).toEqual([]);
  });

  it("becomes a picture with the diagram's description", async () => {
    const { render } = fakeRenderer();
    const built = await buildBook(vault(fence(described)), "Book.md", fonts, {}, { diagrams: render });
    const blocks = built.book.chapters[0].blocks;
    expect(blocks.some((b) => b.kind === "code")).toBe(false);
    const img = blocks.find((b) => b.kind === "image");
    expect(img?.kind === "image" && img.image).toMatchObject({ alt: "Order flow. An order goes from the cart to payment to shipping.", diagram: true, decorative: false, target: "Mermaid diagram" });
    const asset = img?.kind === "image" ? built.book.images.get(img.image.path) : undefined;
    expect(asset?.mime).toBe("image/png");
    expect(asset!.ppi!).toBeGreaterThanOrEqual(DIAGRAM_PPI);
    expect(built.book.warnings).toEqual([]);
    expect(built.audit.issues.filter((i) => i.rule.startsWith("img"))).toEqual([]);
  });

  it("prints at its own size when it fits, sharp, and inside the text block", async () => {
    const { render } = fakeRenderer();
    const built = await buildBook(vault(fence(described)), "Book.md", fonts, {}, { diagrams: render });
    const draw = built.layout.pages.flatMap((p) => p.draws).find((d) => d.kind === "image");
    // 200 × 100 CSS pixels is 150 × 75 points.
    expect(draw?.kind === "image" && draw.w).toBeCloseTo(150, 0);
    expect(draw?.kind === "image" && draw.h).toBeCloseTo(75, 0);
    expect(built.layout.warnings.filter((w) => /ppi/.test(w.message))).toEqual([]);
  });

  it("scales a wide diagram down to the text block and a tall one to the page", async () => {
    const { render } = fakeRenderer();
    const wide = await buildBook(vault(fence("graph LR\n%% size 3000x300\naccTitle: Wide\nA-->B")), "Book.md", fonts, {}, { diagrams: render });
    const tall = await buildBook(vault(fence("graph TD\n%% size 300x3000\naccTitle: Tall\nA-->B")), "Book.md", fonts, {}, { diagrams: render });
    for (const built of [wide, tall]) {
      const page = built.layout.pages.find((p) => p.draws.some((d) => d.kind === "image"))!;
      const d = page.draws.find((x) => x.kind === "image")!;
      const trimW = built.layout.trim.width * 72;
      const trimH = built.layout.trim.height * 72;
      expect(d.x).toBeGreaterThan(0);
      expect(d.x + d.w).toBeLessThan(trimW);
      expect(d.y).toBeGreaterThan(0);
      expect(d.y + d.h).toBeLessThan(trimH);
      expect(built.layout.warnings.filter((w) => /ppi/.test(w.message))).toEqual([]);
    }
  });

  it("asks for a description when the diagram has none, and the audit says so", async () => {
    const { render } = fakeRenderer();
    const built = await buildBook(vault(fence("graph TD\nA-->B")), "Book.md", fonts, {}, { diagrams: render });
    expect(built.book.warnings).toHaveLength(1);
    expect(built.book.warnings[0].message).toMatch(/no description.*accTitle/);
    // The fence starts on line 5 of the chapter note.
    expect(built.book.warnings[0].src).toEqual({ file: "One.md", line: 5 });
    const issue = built.audit.issues.find((i) => i.rule === "img-alt");
    expect(issue?.fix).toMatch(/accTitle/);
    expect(built.audit.passed).toBe(false);
  });

  it("leaves a diagram that fails as code, with Mermaid's message in Problems", async () => {
    const { render } = fakeRenderer();
    const built = await buildBook(vault(fence("flowchat TD\nA-->B")), "Book.md", fonts, {}, { diagrams: render });
    expect(built.book.chapters[0].blocks.find((b) => b.kind === "code")).toMatchObject({ text: "flowchat TD\nA-->B" });
    expect(built.book.warnings.map((w) => w.message)).toEqual(["Mermaid diagram could not be drawn, so it prints as code: Parse error on line 1: flowchat TD Expecting 'GRAPH', got 'NODE_STRING'"]);
    expect(built.layout.pages.length).toBeGreaterThan(0);
  });

  it("treats an empty drawing as a failure", async () => {
    const render: DiagramRenderer = async () => ({ png: new Uint8Array(0), width: 0, height: 0, scale: 1 });
    const built = await buildBook(vault(fence(described)), "Book.md", fonts, {}, { diagrams: render });
    expect(built.book.chapters[0].blocks.some((b) => b.kind === "code")).toBe(true);
    expect(built.book.warnings[0].message).toMatch(/could not be drawn.*empty/);
  });

  it("draws diagrams inside quotes, lists and footnotes, and the same code only once", async () => {
    const { render, calls } = fakeRenderer();
    const quoted = fence(described).split("\n").map((l) => `> ${l}`).join("\n");
    const listed = "- item\n\n  " + fence(described).split("\n").join("\n  ");
    const noted = `Text with a note.[^d]\n\n[^d]: See:\n\n    ${fence(described).split("\n").join("\n    ")}`;
    const built = await buildBook(vault(`${quoted}\n\n${listed}\n\n${noted}\n\n${fence(described)}`), "Book.md", fonts, {}, { diagrams: render });
    const ch = built.book.chapters[0];
    const all = [...flat(ch.blocks), ...ch.notes.flatMap((n) => flat(n.blocks))];
    expect(all.filter((b) => b.kind === "code")).toEqual([]);
    expect(all.filter((b) => b.kind === "image")).toHaveLength(4);
    expect(calls).toHaveLength(1);
    expect(built.book.images.size).toBe(1);
  });

  it("goes into the EPUB as a PNG with its alt text and natural width", async () => {
    const { render } = fakeRenderer();
    const built = await buildBook(vault(fence(described)), "Book.md", fonts, {}, { diagrams: render });
    const zip = await JSZip.loadAsync(await writeEpub(built.book, { accessiblePack: false }));
    const opf = await zip.file("EPUB/package.opf")!.async("string");
    expect(opf).toMatch(/href="images\/diagram-mermaid-[a-z0-9]+\.png" media-type="image\/png"/);
    const xhtml = (await Promise.all(Object.keys(zip.files).filter((f) => f.endsWith(".xhtml")).map((f) => zip.file(f)!.async("string")))).join("\n");
    expect(xhtml).toMatch(/<figure id="[^"]+" class="image diagram"><img src="\.\.\/images\/diagram-mermaid-[a-z0-9]+\.png" alt="Order flow\. An order goes from the cart to payment to shipping\." width="200"\/><\/figure>/);
    expect(auditBook(built.book, { pageList: true }).images.every((i) => i.ok)).toBe(true);
  });

  it("goes into the print PDF", async () => {
    const { render } = fakeRenderer();
    const built = await buildBook(vault(fence(described)), "Book.md", fonts, {}, { diagrams: render });
    const pdf = await exportPdf(built, fonts);
    const text = new TextDecoder("latin1").decode(pdf.data);
    expect(text).toMatch(/\/Subtype\s*\/Image/);
  });

  it("is drawn for the trim's width", async () => {
    const seen: number[] = [];
    const { render } = fakeRenderer();
    const spy: DiagramRenderer = (code, req) => {
      seen.push(req.maxPrintInches);
      return render(code, req);
    };
    await buildBook(vault(fence(described)), "Book.md", fonts, { trim: "5x8" }, { diagrams: spy });
    await buildBook(vault(fence(described)), "Book.md", fonts, {}, { diagrams: spy });
    expect(seen).toEqual([5, 6]);
  });
});
