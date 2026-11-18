// Which web chunks the service worker leaves out of the offline copy at install: the ones only reachable
// through a lazy entry (Mermaid, which only books with diagrams load). It caches those the first time a
// book fetches them, so visitors whose books have no diagrams never download them.

/**
 * @param {{ outputs: Record<string, { entryPoint?: string; imports?: { path: string }[] }> }} metafile esbuild's metafile
 * @param {string[]} roots the build's entry points, e.g. "src/web/main.ts"
 * @param {(entryPoint: string) => boolean} isLazy whether a dynamic-import entry is one to cache on first use
 * @param {string} outdir prefix to strip from the output paths
 * @returns {string[]} output paths relative to outdir, sorted
 */
export function lazyChunks(metafile, roots, isLazy, outdir) {
  const outputs = metafile.outputs;
  const keys = Object.keys(outputs).filter((k) => k.endsWith(".js"));
  const lazyRoots = new Set(keys.filter((k) => outputs[k].entryPoint && isLazy(outputs[k].entryPoint)));
  // Everything the app reaches without going through a lazy entry stays in the offline copy.
  const core = new Set();
  const stack = keys.filter((k) => roots.includes(outputs[k].entryPoint ?? ""));
  while (stack.length) {
    const k = stack.pop();
    if (core.has(k) || lazyRoots.has(k)) continue;
    core.add(k);
    for (const i of outputs[k].imports ?? []) if (i.path in outputs) stack.push(i.path);
  }
  const prefix = outdir.replace(/\/?$/, "/");
  return keys.filter((k) => !core.has(k)).map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k)).sort();
}
