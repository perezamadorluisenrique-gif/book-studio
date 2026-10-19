import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBook, exportEpub, spineWidth, type Built } from "../src/app/pipeline";
import { auditBook } from "../src/engine/a11y";
import { loadBook } from "../src/engine/book";
import { writeEpub } from "../src/engine/epub";
import type { FontSet } from "../src/engine/fonts";
import { testFonts } from "./helpers/fonts";
import { memVault } from "./helpers/memVault";
import { pngHeader } from "./helpers/png";

let fonts: FontSet;
let built: Built;

const files = {
  "Book.md": "---\nbook: true\ntitle: Small Book\nauthor: Ada Writer\nlanguage: en\npublisher: Tiny Press\n---\n## Chapters\n1. [[One]]\n2. [[Two]]\n",
  "One.md": "# One\n\nA first chapter with a control\u0001 character.\n\n![A lighthouse on a rocky point at dusk](light.png)\n",
  "Two.md": "# Two\n\nThe end.[^1]\n\n[^1]: A note.\n",
  "light.png": pngHeader(1200, 800),
};

async function unzip(data: Uint8Array) {
  const zip = await JSZip.loadAsync(data);
  const text = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
  return { zip, text, opf: await text("EPUB/package.opf"), nav: await text("EPUB/nav.xhtml") };
}

beforeAll(async () => {
  fonts = await testFonts();
  built = await buildBook(memVault(files), "Book.md", fonts);
});

describe("EPUB container", () => {
  it("starts with an uncompressed mimetype entry", async () => {
    const data = await writeEpub(built.book, { accessiblePack: false });
    // The OCF spec wants "mimetype" first and stored, so readers can sniff it at a fixed offset.
    expect(new TextDecoder().decode(data.slice(30, 38))).toBe("mimetype");
    expect(new TextDecoder().decode(data.slice(38, 58))).toBe("application/epub+zip");
    const { zip, opf } = await unzip(data);
    expect(Object.keys(zip.files)).toContain("META-INF/container.xml");
    expect(opf).toContain('<dc:language>en</dc:language>');
  });

  it("never writes characters XML forbids", async () => {
    const vault = memVault({ ...files, "Two.md": "# Two\n\nBroken \uD800 surrogate and a \uFFFE noncharacter, \uD83D\uDE00 kept." });
    const book = await loadBook(vault, "Book.md");
    const { zip, text } = await unzip(await writeEpub(book, { accessiblePack: false }));
    const docs = (await Promise.all(Object.keys(zip.files).filter((n) => n.endsWith(".xhtml")).map(text))).join("");
    expect(docs).not.toMatch(/\uFFFE|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(docs).toContain("\uD83D\uDE00 kept");
  });
});

describe("free and Pro EPUBs", () => {
  it("free: structure and navigation, but no accessibility metadata or page list", async () => {
    const { data } = await exportEpub(built, fonts, "free", { claim: true });
    const { opf, nav } = await unzip(data);
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('epub:type="landmarks"');
    expect(nav).not.toContain('epub:type="page-list"');
    expect(opf).not.toContain("schema:accessMode");
    expect(opf).not.toContain("dcterms:conformsTo");
  });

  it("Pro: metadata, print page list and the conformance claim", async () => {
    const { data } = await exportEpub(built, fonts, "pro", { claim: true, certifiedBy: "Checker Co" });
    const { opf, nav } = await unzip(data);
    expect(nav).toContain('epub:type="page-list"');
    expect(opf).toContain('<meta property="schema:accessMode">textual</meta>');
    expect(opf).toContain('<meta property="schema:accessibilityFeature">printPageNumbers</meta>');
    expect(opf).toContain('<meta property="dcterms:conformsTo" id="conformance">EPUB Accessibility 1.1 - WCAG 2.1 Level AA</meta>');
    expect(opf).toContain(">Checker Co</meta>");
  });

  it("Pro: no claim when the author turns it off", async () => {
    const { opf } = await unzip((await exportEpub(built, fonts, "pro", { claim: false })).data);
    expect(opf).toContain("schema:accessMode");
    expect(opf).not.toContain("dcterms:conformsTo");
  });

  it("never claims conformance for a book that fails the audit", async () => {
    const vault = memVault({ ...files, "One.md": "# One\n\n![](light.png)\n" });
    const failing = await buildBook(vault, "Book.md", fonts);
    expect(failing.audit.passed).toBe(false);
    const { opf } = await unzip((await exportEpub(failing, fonts, "pro", { claim: true })).data);
    expect(opf).not.toContain("dcterms:conformsTo");
  });
});

describe("accessibility audit", () => {
  const audit = async (one: string) => auditBook(await loadBook(memVault({ ...files, "One.md": one }), "Book.md"), { pageList: false });
  const rules = async (one: string) => (await audit(one)).issues.map((i) => i.rule);

  it("passes a book with described images", async () => {
    const result = await audit(files["One.md"]);
    expect(result.passed).toBe(true);
    expect(result.images).toEqual([expect.objectContaining({ path: "light.png", ok: true })]);
  });

  it("flags images without a useful description", async () => {
    expect(await rules("# One\n\n![](light.png)\n")).toContain("img-alt");
    expect(await rules("# One\n\n![light.png](light.png)\n")).toContain("img-alt-filename");
    expect(await rules("# One\n\n![Image of a lighthouse](light.png)\n")).toContain("img-alt-redundant");
    expect(await rules("# One\n\n![A lighthouse](missing.png)\n")).toContain("img-missing");
  });

  it("flags vague links and skipped heading levels", async () => {
    expect(await rules("# One\n\nRead [click here](https://example.com).\n")).toContain("link-vague");
    expect(await rules("# One\n\n### Deep\n\nText.\n")).toContain("heading-order");
  });
});

describe("spine width", () => {
  it("uses KDP's paper thickness", () => {
    expect(spineWidth(100)).toBeCloseTo(0.2252, 4);
    expect(spineWidth(100, "cream")).toBeCloseTo(0.25, 4);
  });
});
