// Tests the book details form data: it goes to the front matter and comes back through the book engine
// without losing anything; bad ISBNs and too many keywords are caught; the cover picture is checked and kept.
import { describe, expect, it } from "vitest";
import { loadBook } from "../src/engine/book";
import { splitFrontmatter } from "../src/engine/markdown";
import { settingsFromFrontmatter } from "../src/engine/manifest";
import { imageSize, frontCoverPixels, removeCover, setCover, sniffImage, coverAsset } from "../src/project/cover-image";
import { DETAIL_FIELDS, isbnProblem, keywordsValue, MAX_KEYWORDS, parseKeywords, readDetails, setDetail, setSetting, type BookDetails } from "../src/project/details";
import { createProject } from "../src/project/ops";
import { projectToVault } from "../src/project/to-vault";

const mk = (template = false) => createProject({ id: "p", name: "Blank", now: 1, template });

const FILLED: BookDetails = {
  title: "El faro: una historia",
  subtitle: "Novela de mar",
  author: "Ana María; Luis Pérez",
  language: "es",
  publisher: "Ediciones Faro",
  isbnPrint: "978-84-376-0494-7",
  isbnEbook: "9780306406157",
  copyright: "© 2026 Ana María. Todos los derechos reservados.",
  dedication: "Para quien lo leyó primero.",
  epigraph: "“Mar adentro.”\nNadie",
  description: "Una historia de faros.\n\nY de gente.",
  keywords: "mar, faro, novela",
  series: "Costa Norte",
};

function fill(): ReturnType<typeof mk> {
  let p = mk();
  for (const f of DETAIL_FIELDS) p = setDetail(p, f, FILLED[f], 2);
  p = setSetting(p, "theme", "modern", 3);
  return setSetting(p, "trim", "5x8", 4);
}

describe("book details form", () => {
  it("goes to the front matter and back through the engine without losses", async () => {
    const p = fill();
    expect(readDetails(p)).toEqual(FILLED);
    const v = projectToVault(p);
    const text = await v.read(v.bookPath);
    const { frontmatter } = splitFrontmatter(text);
    expect(settingsFromFrontmatter(frontmatter)).toMatchObject({ theme: "modern", trim: "5x8" });
    const book = await loadBook(v, v.bookPath);
    const m = book.meta;
    expect(m.title).toBe(FILLED.title);
    expect(m.subtitle).toBe(FILLED.subtitle);
    expect(m.authors).toEqual(["Ana María", "Luis Pérez"]);
    expect(m.language).toBe("es");
    expect(m.publisher).toBe(FILLED.publisher);
    expect(m.isbnPrint).toBe(FILLED.isbnPrint);
    expect(m.isbnEbook).toBe(FILLED.isbnEbook);
    expect(m.copyright).toBe(FILLED.copyright);
    expect(m.dedication).toBe(FILLED.dedication);
    expect(m.epigraph).toBe(FILLED.epigraph);
    expect(m.description).toBe(FILLED.description);
    expect(m.subjects).toEqual(["mar", "faro", "novela"]);
    expect(m.series).toBe("Costa Norte");
    expect(book.settings).toMatchObject({ theme: "modern", trim: "5x8" });
  });

  it("an empty value takes the line out, and other spellings are replaced", async () => {
    let p = setDetail(mk(), "keywords", "a, b", 2);
    p = { ...p, meta: { ...p.meta, "ISBN print": "9780306406157" } };
    p = setDetail(p, "isbnPrint", "", 3);
    p = setDetail(p, "keywords", "", 3);
    expect(Object.keys(p.meta).sort()).toEqual(["author", "language", "title"]);
    const v = projectToVault(p);
    expect(await v.read(v.bookPath)).not.toMatch(/isbn|keywords/i);
  });

  it("reads details the Starter Book already has", () => {
    const d = readDetails(mk(true));
    expect(d.author).toBe("Your Name");
    expect(d.copyright).toContain("Your Name");
  });
});

describe("checks", () => {
  it("accepts good ISBNs and empty ones, and says why a bad one fails", () => {
    expect(isbnProblem("")).toBeNull();
    expect(isbnProblem("978-84-376-0494-7")).toBeNull();
    expect(isbnProblem("0306406152")).toBeNull();
    expect(isbnProblem("12345")).toBe("format");
    expect(isbnProblem("9780306406158")).toBe("checksum");
    expect(isbnProblem("1234567890128")).toBe("prefix");
  });

  it("keeps at most seven keywords, without repeats", () => {
    const k = parseKeywords("a, b; c\nd, e, f, g, h, A, i");
    expect(k.all).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    expect(k.kept).toHaveLength(MAX_KEYWORDS);
    expect(k.tooMany).toBe(true);
    expect(keywordsValue("a, b, c, d, e, f, g, h")).toBe("a, b, c, d, e, f, g");
    expect(parseKeywords("a, b").tooMany).toBe(false);
  });
});

describe("cover image", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const v = new DataView(b.buffer);
    v.setUint32(16, w);
    v.setUint32(20, h);
    return b;
  };
  const jpeg = (w: number, h: number) => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
    return b;
  };

  it("tells JPG and PNG from other files and reads their size", () => {
    expect(sniffImage(png(1, 1))).toBe("image/png");
    expect(sniffImage(jpeg(1, 1))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(imageSize(png(1800, 2775))).toEqual({ width: 1800, height: 2775 });
    expect(imageSize(jpeg(640, 960))).toEqual({ width: 640, height: 960 });
  });

  it("needs 1838 x 2775 pixels for a 6 x 9 front cover", () => {
    expect(frontCoverPixels("6x9")).toEqual({ width: Math.ceil(6.125 * 300), height: Math.ceil(9.25 * 300) });
  });

  it("is kept as an asset, named in the front matter, replaced and removed", async () => {
    let p = setCover(mk(), png(10, 10), "image/png", 2);
    expect(p.meta.cover).toBe("cover.png");
    p = setCover(p, jpeg(10, 10), "image/jpeg", 3);
    expect(p.assets.map((a) => a.name)).toEqual(["cover.jpg"]);
    expect(coverAsset(p)?.mime).toBe("image/jpeg");
    const v = projectToVault(p);
    const book = await loadBook(v, v.bookPath);
    expect(book.meta.cover?.path).toBe("Images/cover.jpg");
    expect(book.warnings.filter((w) => /cover/i.test(w.message))).toEqual([]);
    p = removeCover(p, 4);
    expect(p.assets).toEqual([]);
    expect(p.meta.cover).toBeUndefined();
  });
});
