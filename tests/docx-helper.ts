import { DOMParser } from "@xmldom/xmldom";
import type { ParseXml } from "../src/project/import-docx";

/** Node has no DOMParser; xmldom gives the same interface for the tests. */
export const parseXml: ParseXml = (xml) => new DOMParser().parseFromString(xml, "application/xml") as unknown as Document;
