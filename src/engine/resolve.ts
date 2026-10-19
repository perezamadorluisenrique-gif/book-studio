// Obsidian-style link resolution over a plain list of paths, for hosts without a
// metadata cache (the web app, tests). Mirrors Obsidian's rules closely enough:
// exact path, then relative to the linking note, then shortest path by name.

export function createResolver(paths: string[]): (target: string, from: string) => string | null {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    byPath.set(p.toLowerCase(), p);
    const name = p.split("/").pop()!.toLowerCase();
    const add = (k: string) => {
      const list = byName.get(k) ?? [];
      list.push(p);
      byName.set(k, list);
    };
    add(name);
    if (name.endsWith(".md")) add(name.slice(0, -3));
  }
  for (const list of byName.values()) list.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);

  return (target, from) => {
    const t = target.trim().replace(/^\.\//, "");
    if (!t) return null;
    const lower = t.toLowerCase();
    const candidates = [lower, lower + ".md"];
    for (const c of candidates) {
      const hit = byPath.get(c);
      if (hit) return hit;
    }
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    for (const c of candidates) {
      const rel = normalize(dir + c);
      const hit = byPath.get(rel);
      if (hit) return hit;
    }
    const name = lower.split("/").pop()!;
    const list = byName.get(name);
    if (list?.length) {
      // Prefer a match whose path ends with the written partial path.
      return list.find((p) => p.toLowerCase().endsWith(lower) || p.toLowerCase().endsWith(lower + ".md")) ?? list[0];
    }
    return null;
  };
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}
