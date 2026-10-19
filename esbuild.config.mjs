import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const production = process.argv[2] === "production";
const only = process.argv[3]; // "plugin" | "web" | undefined (both)
// Pro builds let people try Pro features without a license key unless
// BOOK_STUDIO_PRO_PREVIEW=0; Pro release builds also set the Polar settings.
// Builds are the free edition, which leaves Pro and licensing out entirely,
// unless BOOK_STUDIO_EDITION=pro.
const freeEdition = process.env.BOOK_STUDIO_EDITION !== "pro";
const proPreview = !freeEdition && process.env.BOOK_STUDIO_PRO_PREVIEW !== "0";
const polarOrg = process.env.BOOK_STUDIO_POLAR_ORG_ID ?? "";
const checkoutUrl = process.env.BOOK_STUDIO_CHECKOUT_URL ?? "";

// JSZip's prebuilt browser file asks the page's require() for Node's
// "stream", which Obsidian reports as an error. Bundling JSZip from its source
// instead lets the request resolve here, to an empty module: the stream API is
// one we don't use.
const noNodeStream = {
  name: "no-node-stream",
  setup(build) {
    build.onResolve({ filter: /^stream$/ }, () => ({ path: "stream", namespace: "empty" }));
    build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "module.exports = {};" }));
  },
};

// JSZip pulls in two scheduling polyfills for old browsers ("setimmediate" and
// "lie", which wraps "immediate"). They create script elements and call
// new Function at runtime, which Obsidian's review flags. Every engine we run
// on has Promise, so "lie" becomes the native one, and "setimmediate" becomes
// a timer-based setImmediate for the platforms (mobile) that lack it.
const noLegacyPolyfills = {
  name: "no-legacy-polyfills",
  setup(build) {
    build.onResolve({ filter: /^(lie|setimmediate)$/ }, (args) => ({ path: args.path, namespace: "polyfill" }));
    build.onLoad({ filter: /^lie$/, namespace: "polyfill" }, () => ({ contents: "module.exports = Promise;" }));
    build.onLoad({ filter: /^setimmediate$/, namespace: "polyfill" }, () => ({
      contents: "if (!globalThis.setImmediate) globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);",
    }));
  },
};

const common = {
  plugins: [noNodeStream, noLegacyPolyfills],
  alias: { jszip: "jszip/lib/index.js" },
  bundle: true,
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  define: {
    __FREE_EDITION__: JSON.stringify(freeEdition),
    __PRO_PREVIEW__: JSON.stringify(proPreview),
    __POLAR_ORG_ID__: JSON.stringify(polarOrg),
    __CHECKOUT_URL__: JSON.stringify(checkoutUrl),
  },
  loader: { ".ttf": "binary" },
};

const plugin = {
  ...common,
  entryPoints: ["src/obsidian/main.ts"],
  format: "cjs",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules.filter((m) => m !== "stream")],
};

const web = {
  ...common,
  entryPoints: ["src/web/main.ts"],
  format: "esm",
  outfile: "dist/web/app.js",
};

function listFiles(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, root, out);
    else out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

function copyWebStatic() {
  mkdirSync("dist/web", { recursive: true });
  cpSync("src/web/index.html", "dist/web/index.html");
  cpSync("src/web/app.css", "dist/web/app.css");
  cpSync("src/app/studio.css", "dist/web/studio.css");
  cpSync("sample", "dist/web/sample", { recursive: true });
  // The browser can't list a folder over HTTP, so the sample ships its file list.
  for (const book of readdirSync("sample")) {
    const dir = join("sample", book);
    if (statSync(dir).isDirectory()) writeFileSync(join("dist/web/sample", book, "files.json"), JSON.stringify(listFiles(dir).sort(), null, 1));
  }
  // The web app fetches fonts on demand instead of inlining them like the plugin does.
  cpSync("fonts", "dist/web/fonts", { recursive: true, filter: (src) => !src.endsWith(".txt") || src.endsWith("OFL.txt") });
}

// Obsidian loads a plugin's styles from styles.css next to main.js.
function copyPluginStatic() {
  cpSync("src/app/studio.css", "styles.css");
}

const targets = [];
if (!only || only === "plugin") targets.push(plugin);
if (!only || only === "web") {
  rmSync("dist/web", { recursive: true, force: true });
  targets.push(web);
}

if (production) {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  if (!only || only === "web") copyWebStatic();
  if (!only || only === "plugin") copyPluginStatic();
} else {
  if (!only || only === "web") copyWebStatic();
  if (!only || only === "plugin") copyPluginStatic();
  for (const t of targets) {
    const ctx = await esbuild.context(t);
    await ctx.watch();
  }
}
