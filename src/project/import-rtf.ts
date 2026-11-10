// Turns a basic Rich Text Format (.rtf) manuscript into a book: text, bold and italic, paragraphs,
// headings by style, centered and right-aligned paragraphs, lists, quotes, tables, footnotes and page
// breaks. Pictures are not read (they are listed in the report). Same report and word-count
// guarantee as the Word import; the shared part is in import-shared.ts.
//
// Pure code: no XML here, only the RTF text.

import { words } from "./import-text";
import { cleanText, finishImport, render, type Block, type ImportedDocx, type ReportCode, type Seg, type SourcePara } from "./import-shared";

export const MAX_RTF_BYTES = 40 * 1024 * 1024;

type Item = { t: "word"; name: string; param: number | null } | { t: "text"; text: string } | { t: "hex"; byte: number } | { t: "group"; items: Item[] };

/** Cut the RTF text into nested groups of control words, text and escaped bytes. */
function tokenize(src: string): Item[] {
  const root: Item[] = [];
  const stack: Item[][] = [root];
  let i = 0;
  let text = "";
  const flush = (): void => {
    if (text) stack[stack.length - 1].push({ t: "text", text });
    text = "";
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      flush();
      const g: Item = { t: "group", items: [] };
      stack[stack.length - 1].push(g);
      stack.push(g.items);
      i++;
    } else if (ch === "}") {
      flush();
      if (stack.length > 1) stack.pop();
      i++;
    } else if (ch === "\\") {
      const next = src[i + 1] ?? "";
      if (next === "'") {
        flush();
        const hex = src.slice(i + 2, i + 4);
        stack[stack.length - 1].push({ t: "hex", byte: parseInt(hex, 16) || 0 });
        i += 4;
      } else if (/[a-zA-Z]/.test(next)) {
        flush();
        const m = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(src.slice(i, i + 40));
        if (!m) {
          i++;
          continue;
        }
        stack[stack.length - 1].push({ t: "word", name: m[1], param: m[2] !== undefined ? Number(m[2]) : null });
        i += m[0].length;
      } else {
        flush();
        // \~ no-break space, \- soft hyphen, \_ no-break hyphen, \* destination marker, \\ \{ \} literal, \<newline> paragraph.
        if (next === "\\" || next === "{" || next === "}") stack[stack.length - 1].push({ t: "text", text: next });
        else if (next === "~") stack[stack.length - 1].push({ t: "text", text: " " });
        else if (next === "_") stack[stack.length - 1].push({ t: "text", text: "-" });
        else if (next === "*") stack[stack.length - 1].push({ t: "word", name: "*", param: null });
        else if (next === "\n" || next === "\r") stack[stack.length - 1].push({ t: "word", name: "par", param: null });
        i += 2;
      }
    } else if (ch === "\r" || ch === "\n") {
      i++;
    } else {
      text += ch;
      i++;
    }
  }
  flush();
  return root;
}

const SKIP = new Set(["fonttbl", "colortbl", "info", "pict", "header", "footer", "headerl", "headerr", "headerf", "footerl", "footerr", "footerf", "listtext", "pntext", "pn", "fldinst", "datafield", "themedata", "colorschememapping", "latentstyles", "generator", "xmlnstbl", "rsidtbl", "listtable", "listoverridetable", "revtbl", "shpinst", "bkmkstart", "bkmkend", "object", "stylesheet", "private"]);

const SPECIAL: Record<string, string> = { emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", bullet: "•", emspace: " ", enspace: " ", tab: " " };

interface Props {
  b: boolean;
  i: boolean;
  strike: boolean;
  caps: boolean;
  sup: boolean;
  sub: boolean;
  uc: number;
}

interface Para {
  align?: "center" | "right";
  style: number | null;
  ls: number | null;
  outline: number | null;
  inTable: boolean;
  pageBefore: boolean;
  depth: number;
}

const freshPara = (): Para => ({ style: null, ls: null, outline: null, inTable: false, pageBefore: false, depth: 0 });

export async function importRtf(bytes: Uint8Array, fileName = ""): Promise<ImportedDocx> {
  if (bytes.byteLength > MAX_RTF_BYTES) throw new Error("docx.tooBig");
  const raw = new TextDecoder("latin1").decode(bytes);
  if (!/^\s*\{\\rtf/.test(raw)) throw new Error("rtf.notRtf");
  const root = tokenize(raw);
  const top = root.find((x): x is Extract<Item, { t: "group" }> => x.t === "group");
  if (!top) throw new Error("rtf.notRtf");

  const counts = new Map<ReportCode, number>();
  const bump = (code: ReportCode, n = 1): void => void counts.set(code, (counts.get(code) ?? 0) + n);
  const cpMatch = /\\ansicpg(\d+)/.exec(raw.slice(0, 400));
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(cpMatch ? `windows-${cpMatch[1]}` : "windows-1252");
  } catch {
    decoder = new TextDecoder("windows-1252");
  }

  // Styles ({\s1 Heading 1;}), list kinds and the document's title and author.
  const styleNames = new Map<number, string>();
  const listOrdered = new Map<number, boolean>(); // \listid → numbered?
  const overrides = new Map<number, number>(); // \ls → \listid
  const meta: { title?: string; creator?: string } = {};
  const textOf = (items: Item[]): string => {
    let out = "";
    let bytes: number[] = [];
    const flush = (): void => {
      if (bytes.length) out += decoder.decode(new Uint8Array(bytes));
      bytes = [];
    };
    for (const x of items) {
      if (x.t === "hex") bytes.push(x.byte);
      else {
        flush();
        if (x.t === "text") out += x.text;
        else if (x.t === "group") out += textOf(x.items);
      }
    }
    flush();
    return out;
  };
  const scan = (items: Item[]): void => {
    for (const x of items) {
      if (x.t !== "group") continue;
      const first = x.items.find((y): y is Extract<Item, { t: "word" }> => y.t === "word");
      if (first?.name === "stylesheet") {
        for (const st of x.items) {
          if (st.t !== "group") continue;
          const s = st.items.find((y) => y.t === "word" && y.name === "s") as Extract<Item, { t: "word" }> | undefined;
          if (s?.param != null) styleNames.set(s.param, textOf(st.items).replace(/;$/, "").trim().toLowerCase());
        }
      } else if (first?.name === "list" || x.items.some((y) => y.t === "word" && y.name === "listid")) {
        const id = x.items.find((y) => y.t === "word" && y.name === "listid") as Extract<Item, { t: "word" }> | undefined;
        const level = x.items.find((y) => y.t === "group" && y.items.some((z) => z.t === "word" && z.name === "levelnfc")) as Extract<Item, { t: "group" }> | undefined;
        const nfc = level?.items.find((z) => z.t === "word" && z.name === "levelnfc") as Extract<Item, { t: "word" }> | undefined;
        if (id?.param != null && nfc) listOrdered.set(id.param, nfc.param === 0);
        else if (id?.param != null && !x.items.some((y) => y.t === "word" && y.name === "ls")) listOrdered.set(id.param, listOrdered.get(id.param) ?? false);
      }
      if (x.items.some((y) => y.t === "word" && y.name === "listoverride")) {
        const lid = x.items.find((y) => y.t === "word" && y.name === "listid") as Extract<Item, { t: "word" }> | undefined;
        const ls = x.items.find((y) => y.t === "word" && y.name === "ls") as Extract<Item, { t: "word" }> | undefined;
        if (lid?.param != null && ls?.param != null) overrides.set(ls.param, lid.param);
      }
      if (first?.name === "info") {
        for (const g of x.items) {
          if (g.t !== "group") continue;
          const w = g.items.find((y): y is Extract<Item, { t: "word" }> => y.t === "word");
          if (w?.name === "title") meta.title = textOf(g.items).trim() || undefined;
          if (w?.name === "author") meta.creator = textOf(g.items).trim() || undefined;
        }
      }
      scan(x.items);
    }
  };
  scan(top.items);

  // Walk the body.
  const blocks: Block[] = [];
  const notesAfter = new Map<number, string[]>();
  const source: SourcePara[] = [];
  const paras: { style: string; text: string; heading: boolean }[] = [];
  let noteCount = 0;
  let pendingNotes: string[] = [];
  let place = "";
  let emptyRun = 0;
  let segs: Seg[] = [];
  let para: Para = freshPara();
  const cells: string[] = [];
  let cellParas: string[] = [];
  let rows: string[][] = [];
  const hexBuf: number[] = [];

  const plainOf = (list: Seg[]): string => list.map((s) => (s.text === "\uE000BR" ? " " : s.text.startsWith("\uE000") ? "" : s.text)).join("").replace(/\s+/g, " ").trim();
  let noteParts: string[] | null = null;

  const push = (text: string, p: Props): void => {
    if (!text) return;
    const x = (p.strike ? "s" : "") + (p.caps ? "c" : "") + (p.sup ? "u" : "") + (p.sub ? "d" : "");
    segs.push({ text, b: p.b, i: p.i, x });
  };
  const flushHex = (p: Props): void => {
    if (hexBuf.length) {
      push(decoder.decode(new Uint8Array(hexBuf)), p);
      hexBuf.length = 0;
    }
  };

  const flushTable = (): void => {
    if (!rows.length) return;
    bump("tables");
    const cols = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]): string => `| ${Array.from({ length: cols }, (_, k) => r[k] ?? "").join(" | ")} |`;
    blocks.push({ kind: "table", text: "", rows: [line(rows[0]), `|${" --- |".repeat(cols)}`, ...rows.slice(1).map(line)] });
    rows = [];
  };

  const endParagraph = (): void => {
    const plainText = plainOf(segs);
    const text = cleanText(render(null, segs).trim());
    const notes = pendingNotes;
    pendingNotes = [];
    const current = para;
    segs = [];
    para = freshPara();
    if (current.inTable) {
      if (text) cellParas.push(text.replace(/ {2}\n/g, " ").replace(/\|/g, "\\|"));
      if (plainText && words(plainText).length) source.push({ text: plainText, place });
      return;
    }
    flushTable();
    if (words(plainText).length) source.push({ text: plainText, place: place });
    if (!text) {
      emptyRun++;
      return;
    }
    const style = current.style !== null ? (styleNames.get(current.style) ?? "") : "";
    const hm = /^heading ?(\d)/.exec(style);
    const level = hm ? Number(hm[1]) : current.outline !== null && current.outline < 9 ? current.outline + 1 : 0;
    const prev = blocks[blocks.length - 1];
    const out: Block[] = [];
    if (current.pageBefore) out.push({ kind: "pageBreak", text: "" });
    if (level) {
      place = plainText;
      out.push({ kind: "heading", level, text: text.replace(/\*+/g, "").replace(/\\([\\*_[\]<>`])/g, "$1").replace(/\s+/g, " ").trim() });
    } else if (style === "title") out.push({ kind: "paragraph", text, title: true });
    else if (style === "subtitle") out.push({ kind: "paragraph", text, subtitle: true });
    else if (style === "author") out.push({ kind: "paragraph", text, author: true });
    else if (current.ls !== null && current.ls > 0) out.push({ kind: "list", text, ordered: listOrdered.get(overrides.get(current.ls) ?? -1) ?? false, depth: current.depth });
    else if (/quot|block text|cita/.test(style)) out.push({ kind: "quote", text });
    else out.push({ kind: "paragraph", text, ...(current.align ? { align: current.align } : {}) });
    paras.push({ style: style, text: plainText, heading: level > 0 });
    // Two or more empty paragraphs in a row between text are a scene break.
    if (emptyRun >= 2 && prev && ["paragraph", "quote", "list", "table"].includes(prev.kind) && ["paragraph", "quote", "list"].includes(out[0].kind)) blocks.push({ kind: "paragraph", text: "* * *" });
    emptyRun = 0;
    blocks.push(...out);
    if (notes.length) notesAfter.set(blocks.length - 1, notes);
  };

  const walk = (items: Item[], inherited: Props, destination: string | null): void => {
    let p: Props = { ...inherited };
    for (let k = 0; k < items.length; k++) {
      const x = items[k];
      if (x.t === "text") {
        flushHex(p);
        if (!destination) push(x.text, p);
      } else if (x.t === "hex") {
        if (!destination) hexBuf.push(x.byte);
      } else if (x.t === "group") {
        flushHex(p);
        const first = x.items[0];
        const starred = first?.t === "word" && first.name === "*";
        const w = (starred ? x.items[1] : first) as Item | undefined;
        const name = w?.t === "word" ? w.name : "";
        if (destination) continue;
        if (name === "footnote") {
          const saved = { segs, para };
          const num = ++noteCount;
          const parts: string[] = [];
          const outer = noteParts;
          noteParts = parts;
          segs = [];
          para = freshPara();
          walk(x.items.slice(starred ? 2 : 1), { ...p }, null);
          const last = render(null, segs).replace(/\n+/g, " ").trim();
          if (last) {
            parts.push(last);
            source.push({ text: plainOf(segs), place: `[^${num}]` });
          }
          noteParts = outer;
          segs = saved.segs;
          para = saved.para;
          segs.push({ text: `\uE000RAW[^${num}]\uE000`, b: false, i: false });
          pendingNotes.push(`${num}\uE000${parts.join(" ")}`);
        } else if (name === "field") {
          // A link: {\field{\*\fldinst HYPERLINK "url"}{\fldrslt text}}
          const inst = x.items.find((y): y is Extract<Item, { t: "group" }> => y.t === "group" && y.items.some((z) => z.t === "word" && z.name === "fldinst"));
          const url = /HYPERLINK\s+"([^"]+)"/i.exec(inst ? textOf(inst.items) : "")?.[1];
          const result = x.items.find((y): y is Extract<Item, { t: "group" }> => y.t === "group" && y.items.some((z) => z.t === "word" && z.name === "fldrslt"));
          if (result && url && /^(https?:|mailto:)/i.test(url)) {
            segs.push({ text: "\uE000RAW[\uE000", b: false, i: false });
            walk(result.items, { ...p }, null);
            segs.push({ text: `\uE000RAW](<${url}>)\uE000`, b: false, i: false });
          } else if (result) walk(result.items, { ...p }, null);
        } else if (name === "pict" || name === "shppict" || name === "nonshppict") {
          if (name === "pict") bump("unsupportedImages");
          else if (name === "shppict") bump("unsupportedImages");
        } else if (SKIP.has(name) || starred) {
          // Destinations we do not read (fonts, colours, headers, field codes…).
          if (!starred && name === "fldinst") continue;
        } else walk(x.items, { ...p }, null);
      } else {
        const n = x.name;
        if (destination) continue;
        switch (n) {
          case "b": p.b = x.param !== 0; break;
          case "i": p.i = x.param !== 0; break;
          case "strike": p.strike = x.param !== 0; break;
          case "scaps": p.caps = x.param !== 0; break;
          case "super": p.sup = true; p.sub = false; break;
          case "sub": p.sub = true; p.sup = false; break;
          case "nosupersub": p.sup = false; p.sub = false; break;
          case "plain": p = { ...p, b: false, i: false, strike: false, caps: false, sup: false, sub: false }; break;
          case "uc": p.uc = x.param ?? 1; break;
          case "u": {
            flushHex(p);
            const code = (x.param ?? 63) < 0 ? (x.param ?? 63) + 65536 : (x.param ?? 63);
            push(String.fromCharCode(code), p);
            // The fallback characters after \uN (\uc of them) are skipped.
            let skip = p.uc;
            while (skip > 0 && k + 1 < items.length) {
              const nx = items[k + 1];
              if (nx.t === "hex") { k++; skip--; } else if (nx.t === "text" && nx.text.length > 0) {
                if (nx.text.length <= skip) { skip -= nx.text.length; k++; } else { items[k + 1] = { t: "text", text: nx.text.slice(skip) }; skip = 0; }
              } else break;
            }
            break;
          }
          case "par":
            flushHex(p);
            if (noteParts) {
              const t = render(null, segs).replace(/\n+/g, " ").trim();
              if (t) {
                noteParts.push(t);
                source.push({ text: plainOf(segs), place: "[^]" });
              }
              segs = [];
            } else endParagraph();
            break;
          case "line": flushHex(p); segs.push({ text: "\uE000BR", b: false, i: false }); break;
          case "page": flushHex(p); endParagraph(); blocks.push({ kind: "pageBreak", text: "" }); break;
          case "pagebb": para.pageBefore = true; break;
          case "pard": para = freshPara(); break;
          case "qc": para.align = "center"; break;
          case "qr": para.align = "right"; break;
          case "ql": case "qj": para.align = undefined; break;
          case "s": para.style = x.param; break;
          case "ls": para.ls = x.param; break;
          case "ilvl": para.depth = x.param ?? 0; break;
          case "outlinelevel": para.outline = x.param; break;
          case "intbl": para.inTable = true; break;
          case "cell": {
            flushHex(p);
            if (segs.length) endParagraph();
            cells.push(cellParas.join("<br>"));
            cellParas = [];
            break;
          }
          case "row": {
            if (cells.length) rows.push([...cells]);
            cells.length = 0;
            break;
          }
          default:
            if (n in SPECIAL) push(SPECIAL[n], p);
        }
      }
    }
    flushHex(p);
  };

  walk(top.items, { b: false, i: false, strike: false, caps: false, sup: false, sub: false, uc: 1 }, null);
  if (segs.length) endParagraph();
  flushTable();

  // Own styles that look like chapter titles are not offered for RTF: styles are rarely named there.
  void paras;
  return finishImport({ blocks, notesAfter, fileName, assets: [], counts, footnotes: noteCount, source, titleStyles: [], meta });
}
