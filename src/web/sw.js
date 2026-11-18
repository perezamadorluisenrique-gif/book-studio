// Service worker of the web app: keeps the app and its fonts on the device so it opens and works without a network.
// The build (esbuild.config.mjs) fills in the build hash and the list of files to keep below,
// so every release gets its own cache and the old one is deleted. It never takes over a running page by itself:
// the page asks (message "skip-waiting") once the person agrees to reload.

const BUILD = "__BUILD__";
const CORE = `bs-core-${BUILD}`;
const SAMPLES = "bs-samples";
const TOOLS = "bs-tools";
// The free KDP tools on the site (their pages, script and styles) are saved as they are opened.
const TOOL_PAGE = /^(en\/tools|es\/herramientas)(\/|$)|^tools\/tools\.js$|^site\.css$/;
const FILES = __FILES__;
// Chunks only some books load (Mermaid, for diagrams): cached the first time they are fetched, then served
// from that cache, so the offline copy doesn't carry them for everyone. Their names carry a content hash.
const LAZY_CACHE = "bs-lazy";
const LAZY = __LAZY__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CORE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CORE && key !== SAMPLES && key !== TOOLS && key !== LAZY_CACHE) await caches.delete(key);
      // Chunks of an older build are never asked for again.
      const lazy = await caches.open(LAZY_CACHE);
      for (const req of await lazy.keys()) if (!LAZY.includes(new URL(req.url).href.slice(self.registration.scope.length))) await lazy.delete(req);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = self.registration.scope;
  if (!url.href.startsWith(scope)) return;
  const rel = url.href.slice(scope.length).split("?")[0];

  // The page itself: the network first so a new release shows up, the saved copy when offline.
  if (req.mode === "navigate" && (rel === "" || rel === "index.html")) {
    event.respondWith(fetch(req).catch(() => caches.open(CORE).then((c) => c.match("./", { ignoreSearch: true })).then((r) => r || Response.error())));
    return;
  }
  // The tools: the network first so a fix shows up, the saved copy when offline (the address may carry ?pages=… values).
  if (TOOL_PAGE.test(rel)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(TOOLS).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.open(TOOLS).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || Response.error())),
    );
    return;
  }
  // Sample books: saved as they are opened; the network first, so they stay current.
  if (rel.startsWith("sample/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(SAMPLES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.error())),
    );
    return;
  }
  // The app itself and the fonts: kept at install, so the saved copy is always right for this build.
  if (LAZY.includes(rel)) {
    event.respondWith(
      caches.open(LAZY_CACHE).then((c) =>
        c.match(req, { ignoreSearch: true }).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) void c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  if (FILES.includes(rel === "" ? "./" : rel)) {
    event.respondWith(caches.open(CORE).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || fetch(req)));
  }
  // Anything else (the guides, downloads) goes to the network as usual.
});
