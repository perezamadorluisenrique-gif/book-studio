import { describe, expect, it } from "vitest";
import { parseCoverDesign, type CoverDesign } from "../src/engine/cover/design";
import { coverGeometry } from "../src/engine/cover/geometry";
import { addImageLayer, addTextLayer, canRedo, canUndo, commit, guideLines, layerById, moveLayer, patchLayer, redo, removeLayer, snapLayer, stackLayer, startHistory, undo } from "../src/project/cover-ops";
import { trimById } from "../src/engine/trims";

const base: CoverDesign = parseCoverDesign({
  version: 1,
  background: { kind: "color", color: "#112233" },
  layers: [
    { id: "a", kind: "text", panel: "front", x: 0.3, y: 0.3, w: 0.4, h: 0.1, text: "Hello", size: 20, color: "#ffffff" },
    { id: "b", kind: "rect", panel: "front", x: 0, y: 0.9, w: 1, h: 0.1, color: "#ff0000" },
  ],
}).design;
const g = coverGeometry(trimById("6x9")!, 300, "white");

describe("history", () => {
  it("undoes and redoes, and ignores a change that changes nothing", () => {
    let h = startHistory(base);
    h = commit(h, base);
    expect(canUndo(h)).toBe(false);
    h = commit(h, patchLayer(base, "a", { text: "Bye" }));
    expect(canUndo(h)).toBe(true);
    expect((layerById(h.present, "a") as { text: string }).text).toBe("Bye");
    h = undo(h);
    expect((layerById(h.present, "a") as { text: string }).text).toBe("Hello");
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect((layerById(h.present, "a") as { text: string }).text).toBe("Bye");
    h = undo(h);
    h = commit(h, removeLayer(base, "b"));
    expect(canRedo(h)).toBe(false);
  });
  it("keeps at most 100 steps", () => {
    let h = startHistory(base);
    for (let i = 0; i < 130; i++) h = commit(h, moveLayer(h.present, "a", 0.001 * (i % 2 ? -1 : 1) + 0.0001 * i, 0));
    expect(h.past.length).toBe(100);
  });
});

describe("layers", () => {
  it("moves a layer but never lets it leave the panel entirely", () => {
    const m = moveLayer(base, "a", 5, -5);
    const l = layerById(m, "a")!;
    expect(l.x).toBeLessThan(1);
    expect(l.x + l.w).toBeGreaterThan(0.9);
    expect(l.y + l.h).toBeGreaterThan(0);
  });
  it("snaps edges and centres to the panel's guides and says which", () => {
    const near = patchLayer(base, "a", { x: 0.304 });
    const { design, guides } = snapLayer(near, "a", g);
    // The layer is 0.4 wide, so its centre is at 0.504 and snaps to the middle.
    expect(layerById(design, "a")!.x).toBeCloseTo(0.3, 9);
    expect(guides).toContainEqual({ panel: "front", axis: "x", at: 0.5 });
    const far = snapLayer(patchLayer(base, "a", { x: 0.2, y: 0.22 }), "a", g);
    expect(far.guides).toEqual([]);
  });
  it("has guides at the edges, the safe margins and the middle", () => {
    const x = guideLines(g, "front", "x");
    expect(x[0]).toBe(0);
    expect(x[1]).toBeCloseTo(0.25 / 6, 9);
    expect(x[2]).toBe(0.5);
    expect(x[4]).toBe(1);
  });
  it("adds, restacks and removes layers with fresh ids", () => {
    const t = addTextLayer(base, "back", "New", "#fff");
    const p = addImageLayer(t.design, "front", "pic.jpg", "Images/pic.jpg", "A picture");
    expect(new Set(p.design.layers.map((l) => l.id)).size).toBe(4);
    const up = stackLayer(p.design, "a", 1);
    expect(up.layers.map((l) => l.id).slice(0, 2)).toEqual(["b", "a"]);
    expect(stackLayer(up, up.layers[3].id, 1)).toBe(up);
    expect(removeLayer(up, "a").layers.some((l) => l.id === "a")).toBe(false);
  });
  it("keeps kind, panel and id when patching", () => {
    const m = patchLayer(base, "a", { id: "z", panel: "back", kind: "rect" } as never);
    expect(layerById(m, "a")).toMatchObject({ kind: "text", panel: "front" });
  });
});
