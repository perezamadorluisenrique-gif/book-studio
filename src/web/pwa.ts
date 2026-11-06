// Registers the service worker that lets the web app work offline, and tells the page when a new version is waiting.

export interface PwaHooks {
  /** The first visit finished saving the app: it now works offline. */
  ready(): void;
  /** A newer version is installed and waiting; call `apply()` to switch to it (the page reloads). */
  update(apply: () => void): void;
}

export function registerPwa(hooks: PwaHooks): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const sw = navigator.serviceWorker;
  // Whether this page was opened by an earlier version: only then is a new worker an "update", not a first install.
  const hadController = !!sw.controller;
  const offer = (reg: ServiceWorkerRegistration) =>
    hooks.update(() => {
      sw.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      reg.waiting?.postMessage("skip-waiting");
    });
  sw.register("sw.js").then(
    (reg) => {
      if (reg.waiting && hadController) offer(reg);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state !== "installed") return;
          if (hadController || sw.controller) offer(reg);
          else hooks.ready();
        });
      });
    },
    () => undefined, // No service worker (private window, blocked): the app just needs the network as before.
  );
}
