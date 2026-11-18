// Draw Mermaid diagrams for the book: Mermaid makes the SVG, a canvas turns it into a PNG sharp
// enough for print. Shared by both hosts; each says where its Mermaid comes from (Obsidian's own
// copy, or the web app's chunk that loads only when a book has a diagram).

import { diagramScale, forPrint, sizedSvg, svgSize, type DiagramRenderer, type RenderedDiagram } from "../engine/diagrams";
import { h } from "./dom";

/** The part of Mermaid's API this uses; Obsidian's copy and the npm package both have it. */
export interface MermaidLike {
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** Diagrams drawn this session, by code and print width, so an edit elsewhere in the book doesn't redraw them. */
const KEEP = 64;

export function createDiagramRenderer(load: () => Promise<MermaidLike>): DiagramRenderer {
  const drawn = new Map<string, Promise<RenderedDiagram>>();
  let mermaid: Promise<MermaidLike> | null = null;
  // Mermaid keeps global state while it draws: one diagram at a time.
  let queue: Promise<unknown> = Promise.resolve();
  let n = 0;

  const get = (): Promise<MermaidLike> => {
    if (!mermaid) {
      // A failed load (offline before the chunk was cached, say) is tried again next time.
      mermaid = load().catch((e: unknown) => {
        mermaid = null;
        throw e;
      });
    }
    return mermaid;
  };

  const draw = async (code: string, maxPrintInches: number): Promise<RenderedDiagram> => {
    const m = await get();
    const id = `bs-mermaid-${Date.now().toString(36)}-${++n}`;
    let svg: string;
    try {
      ({ svg } = await m.render(id, forPrint(code)));
    } finally {
      // Mermaid leaves its scratch element behind when the code doesn't parse.
      const doc = h("div").ownerDocument;
      for (const left of [id, `d${id}`]) doc.getElementById(left)?.remove();
    }
    const size = svgSize(svg);
    if (!size) throw new Error("Mermaid gave no picture size.");
    const scale = diagramScale(size.width, size.height, maxPrintInches);
    const png = await rasterize(sizedSvg(svg, size.width, size.height), Math.round(size.width * scale), Math.round(size.height * scale));
    return { png, width: size.width, height: size.height, scale };
  };

  return (code, request) => {
    const key = `${request.maxPrintInches}\n${code}`;
    const hit = drawn.get(key);
    if (hit) {
      drawn.delete(key);
      drawn.set(key, hit);
      return hit;
    }
    const job = queue.then(() => draw(code, request.maxPrintInches));
    queue = job.catch(() => undefined);
    drawn.set(key, job);
    // Only keep what Mermaid itself refused; a failed load or canvas is tried again on the next build.
    job.catch(() => {
      if (!mermaid) drawn.delete(key);
    });
    while (drawn.size > KEEP) drawn.delete(drawn.keys().next().value as string);
    return job;
  };
}

/** Paint the SVG on white (printers flatten transparency) and encode a PNG. */
async function rasterize(svg: string, width: number, height: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = h("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("the diagram could not be turned into a picture"));
      img.src = url;
    });
    const canvas = h("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas to draw the diagram on");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("the diagram is too large to draw");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
