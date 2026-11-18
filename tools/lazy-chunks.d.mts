// Types for tools/lazy-chunks.mjs, a plain ESM build helper, so the tests can import it.

export interface Metafile {
  outputs: Record<string, { entryPoint?: string; imports?: { path: string; kind?: string }[] }>;
}

export function lazyChunks(metafile: Metafile, roots: string[], isLazy: (entryPoint: string) => boolean, outdir: string): string[];
