// Talks to layout-worker.ts. `remoteLayout` is what the web host gives the studio; it rejects when the worker
// can't run (no module workers, the file missing, an error inside), and the studio then sets the pages on the page itself.

import type { Layout } from "../engine/layout/index";
import type { Book } from "../engine/model";
import type { LayoutReply, LayoutRequest } from "./layout-worker";

export function remoteLayout(workerUrl: URL): ((book: Book) => Promise<Layout>) | undefined {
  if (typeof Worker === "undefined") return undefined;
  let worker: Worker | null = null;
  let broken = false;
  let next = 0;
  const pending = new Map<number, { ok: (l: Layout) => void; fail: (e: Error) => void }>();

  const failAll = (error: Error): void => {
    broken = true;
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.fail(error);
    pending.clear();
  };

  const start = (): Worker => {
    const w = new Worker(workerUrl, { type: "module" });
    w.onmessage = (e: MessageEvent<LayoutReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if ("error" in e.data) p.fail(new Error(e.data.error));
      else p.ok(e.data.layout);
    };
    w.onerror = (e) => failAll(new Error(e.message || "The layout worker failed"));
    w.onmessageerror = () => failAll(new Error("The layout worker sent something unreadable"));
    return w;
  };

  return (book) =>
    new Promise<Layout>((ok, fail) => {
      if (broken) return fail(new Error("The layout worker is not available"));
      try {
        worker ??= start();
        const id = ++next;
        pending.set(id, { ok, fail });
        // The layout never reads the pixels of an image, only its size.
        const images = new Map([...book.images].map(([path, a]) => [path, { ...a, bytes: new Uint8Array(0) }]));
        const request: LayoutRequest = { id, book: { ...book, images } };
        worker.postMessage(request);
      } catch (err) {
        failAll(err instanceof Error ? err : new Error(String(err)));
      }
    });
}
