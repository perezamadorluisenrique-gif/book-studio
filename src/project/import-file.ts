// One door for the three kinds of word-processor file: .docx (Word, Google Docs), .odt (LibreOffice)
// and .rtf. Each reader is loaded only when someone imports that kind of file.

import type { ParseXml } from "./import-docx";
import type { ImportedDocx } from "./import-shared";

/** The file kinds that are read from bytes (everything else is plain text). */
export const DOCUMENT_EXTENSION = /\.(docx|odt|rtf)$/i;

export async function importFile(bytes: Uint8Array, parse: ParseXml, fileName: string, options: { titleStyles?: string[] } = {}): Promise<ImportedDocx> {
  const kind = DOCUMENT_EXTENSION.exec(fileName)?.[1]?.toLowerCase();
  if (kind === "odt") return (await import("./import-odt")).importOdt(bytes, parse, fileName, options);
  if (kind === "rtf") return (await import("./import-rtf")).importRtf(bytes, fileName);
  return (await import("./import-docx")).importDocx(bytes, parse, fileName, options);
}
