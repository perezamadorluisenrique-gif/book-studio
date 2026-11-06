// Service worker of the web app: keeps the app and its fonts on the device so it opens and works without a network.
// The build (esbuild.config.mjs) fills in the build hash and the list of files to keep below,
// so every release gets its own cache and the old one is deleted. It never takes over a running page by itself:
// the page asks (message "skip-waiting") once the person agrees to reload.

const BUILD = "__BUILD__";
const CORE = `bs-core-${BUILD}`;
const SAMPLES = "bs-samples";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CORE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CORE && key !== SAMPLES) await caches.delete(key);
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
  if (FILES.includes(rel === "" ? "./" : rel)) {
    event.respondWith(caches.open(CORE).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || fetch(req)));
  }
  // Anything else (the guides, downloads) goes to the network as usual.
});
