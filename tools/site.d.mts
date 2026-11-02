// Types for tools/site.mjs, a plain ESM build script, so the tests can import it.

export interface SitePage {
  title: string;
  description: string;
  slug: string;
  pair: string;
  updated: string;
  type: "hub" | "article" | "howto";
  order: number;
  steps?: string[];
  h1?: string;
  body: string;
  lang: "en" | "es";
  file: string;
}

export const SITE: string;
export const PRO_PAGE: Record<"en" | "es", string>;
export const LANGS: readonly ("en" | "es")[];
export function readSource(text: string, file: string): Omit<SitePage, "lang" | "file">;
export function loadPages(dir: string): SitePage[];
export function pagePath(page: SitePage): string;
export function renderBody(page: SitePage, ctx: { pages: SitePage[]; downloads: unknown[] }): string;
export function renderPage(page: SitePage, ctx: { pages: SitePage[]; downloads: unknown[] }): string;
export function auditPages(pages: SitePage[]): string[];
export function buildSite(siteDir: string, out: string): { pages: number; downloads: number };
