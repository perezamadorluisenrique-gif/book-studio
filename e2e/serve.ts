/// <reference types="node" />
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".woff": "font/woff", ".txt": "text/plain",
};

/** Serves a folder on a free local port; resolves with the server and its base URL. */
export async function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      let path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
      if (path.includes("..")) { res.writeHead(400).end(); return; }
      if (path.endsWith("/")) path += "index.html";
      try {
        const body = await readFile(join(root, path));
        res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    })();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, url: `http://127.0.0.1:${port}/` };
}
