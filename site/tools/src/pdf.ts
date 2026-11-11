// A one-page PDF drawn from template steps, written by hand: a few lines of vector graphics and
// Helvetica text. No library, so the tools page stays small; the tests open the file with pdf-lib.

import type { Op, Rgb } from "./template";

const PT = 72;
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
const col = (c: Rgb) => c.map(f).join(" ");

/** Escape for a PDF string; Latin-1 only, which the standard Helvetica font covers. */
function pdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 63;
    const b = code === 0x2013 || code === 0x2014 ? 45 : code < 256 ? code : 63;
    if (b === 40 || b === 41 || b === 92) out += `\\${String.fromCharCode(b)}`;
    else if (b < 32) out += " ";
    else if (b < 128) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  return out;
}

/** Width of Helvetica text, close enough to centre a label: 0.5 em per character. */
const textWidth = (s: string, size: number) => s.length * size * 0.5;

export function templatePdf(widthIn: number, heightIn: number, ops: Op[]): Uint8Array {
  const W = widthIn * PT;
  const H = heightIn * PT;
  const y = (v: number) => H - v * PT;
  let s = "q 0.5 w\n";
  for (const op of ops) {
    if (op.k === "rect") {
      if (op.fill) s += `${col(op.fill)} rg ${f(op.x * PT)} ${f(y(op.y + op.h))} ${f(op.w * PT)} ${f(op.h * PT)} re f\n`;
      if (op.stroke) s += `${col(op.stroke)} RG ${op.dash ? "[3 3] 0 d" : "[] 0 d"} ${f(op.x * PT)} ${f(y(op.y + op.h))} ${f(op.w * PT)} ${f(op.h * PT)} re S\n`;
    } else if (op.k === "line") {
      s += `${col(op.stroke)} RG ${op.dash ? "[3 3] 0 d" : "[] 0 d"} ${f(op.x1 * PT)} ${f(y(op.y1))} m ${f(op.x2 * PT)} ${f(y(op.y2))} l S\n`;
    } else {
      const half = op.anchor === "middle" ? textWidth(op.text, op.size) / 2 : 0;
      const px = op.x * PT;
      const py = y(op.y);
      const tm = op.rotate ? `0 1 -1 0 ${f(px)} ${f(py - half)} Tm` : `1 0 0 1 ${f(px - half)} ${f(py)} Tm`;
      s += `BT /F1 ${f(op.size)} Tf ${col(op.fill)} rg ${tm} (${pdfText(op.text)}) Tj ET\n`;
    }
  }
  s += "Q\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${s.length} >>\nstream\n${s}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}
