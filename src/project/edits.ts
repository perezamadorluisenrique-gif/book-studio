// Small text edits for the chapter editor (bold, italic, heading, quote…). Each one takes the text and
// the selection and gives back the new text and where the selection should be. No screen code, so it is easy to test.

export interface Edit {
  text: string;
  /** Where the selection starts and ends after the edit. */
  start: number;
  end: number;
}

/** Wrap the selection in a marker ("**" for bold, "*" for italic); wrap again to undo. With nothing selected, put the cursor between two markers. */
export function wrap(text: string, start: number, end: number, marker: string): Edit {
  const n = marker.length;
  const sel = text.slice(start, end);
  const single = marker === "*";
  // Already wrapped, with the markers outside the selection.
  if (text.slice(start - n, start) === marker && text.slice(end, end + n) === marker && !(single && (text[start - 2] === "*" || text[end + 1] === "*"))) {
    return { text: text.slice(0, start - n) + sel + text.slice(end + n), start: start - n, end: end - n };
  }
  // Already wrapped, with the markers inside the selection.
  if (sel.length >= 2 * n + 1 && sel.startsWith(marker) && sel.endsWith(marker) && !(single && sel.startsWith("**"))) {
    return { text: text.slice(0, start) + sel.slice(n, -n) + text.slice(end), start, end: end - 2 * n };
  }
  return { text: text.slice(0, start) + marker + sel + marker + text.slice(end), start: start + n, end: end + n };
}

/** Where the line that holds `pos` starts and ends. */
function lineRange(text: string, pos: number): [number, number] {
  const from = pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;
  const to = text.indexOf("\n", pos);
  return [from, to < 0 ? text.length : to];
}

/** Make the line with the cursor a section title ("## "); do it again to turn it back into plain text. */
export function heading(text: string, start: number, end: number): Edit {
  const [from, to] = lineRange(text, start);
  const line = text.slice(from, to);
  const plain = line.replace(/^#{1,6}\s+/, "");
  const next = line.startsWith("## ") ? plain : `## ${plain}`;
  const shift = next.length - line.length;
  return { text: text.slice(0, from) + next + text.slice(to), start: Math.max(from, start + shift), end: Math.max(from, end + shift) };
}

/** Put a scene break (* * *) on its own line, with a blank line each side, at the cursor. */
export function sceneBreak(text: string, start: number, end: number): Edit {
  const before = text.slice(0, start).replace(/[ \t]+$/, "");
  const after = text.slice(end).replace(/^[ \t]+/, "");
  const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const mark = `${lead}* * *${tail}`;
  const pos = before.length + mark.length;
  return { text: before + mark + after, start: pos, end: pos };
}

/** Turn the selection into a footnote, ^[text]; with nothing selected the cursor goes inside the brackets. */
export function footnote(text: string, start: number, end: number): Edit {
  const sel = text.slice(start, end);
  return { text: `${text.slice(0, start)}^[${sel}]${text.slice(end)}`, start: start + 2, end: start + 2 + sel.length };
}

/** Quote the lines of the selection ("> "); do it again to remove the quote. */
export function quote(text: string, start: number, end: number): Edit {
  const [from] = lineRange(text, start);
  const [, to] = lineRange(text, end > start && text[end - 1] === "\n" ? end - 1 : end);
  const lines = text.slice(from, to).split("\n");
  const quoted = lines.every((l) => l.startsWith(">") || l.trim() === "") && lines.some((l) => l.startsWith(">"));
  const next = lines.map((l) => (quoted ? l.replace(/^>\s?/, "") : l.trim() === "" ? l : `> ${l}`)).join("\n");
  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length };
}

/** How many words the text has (a word has at least one letter or digit). */
export function countWords(text: string): number {
  let n = 0;
  for (const w of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  return n;
}

/** The place in `text` where line `line` (from 1) starts; past the end gives the end. */
export function lineOffset(text: string, line: number): number {
  let pos = 0;
  for (let i = 1; i < line; i++) {
    const next = text.indexOf("\n", pos);
    if (next < 0) return text.length;
    pos = next + 1;
  }
  return pos;
}
