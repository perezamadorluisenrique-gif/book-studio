// Tests for the browser storage of the web app, on a pretend IndexedDB: saving, listing and
// deleting projects, and upgrading an old (version 1) database without losing the saved folder.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../src/project/ops";
import { deleteProject, getHandle, getProject, listProjects, putProject, setHandle } from "../src/web/store";

beforeEach(async () => {
  await new Promise<void>((ok) => {
    const req = indexedDB.deleteDatabase("book-studio");
    req.onsuccess = () => ok();
    req.onerror = () => ok();
  });
});

/** A database as the first version of the app left it: only the "handles" store. */
function makeV1(handle: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("book-studio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(handle, "folder");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error("failed"));
    };
    req.onerror = () => reject(req.error ?? new Error("failed"));
  });
}

describe("web store", () => {
  it("saves, reads, lists (newest first) and deletes projects", async () => {
    const a = createProject({ id: "a", name: "Old", now: 1, template: true });
    const b = createProject({ id: "b", name: "New", now: 2 });
    await putProject(a);
    await putProject(b);
    expect((await listProjects()).map((p) => p.id)).toEqual(["b", "a"]);
    expect(await getProject("a")).toEqual(a);
    await putProject({ ...a, name: "Renamed", updatedAt: 3 });
    expect((await listProjects()).map((p) => p.name)).toEqual(["Renamed", "New"]);
    await deleteProject("a");
    expect(await getProject("a")).toBeUndefined();
    expect(await listProjects()).toHaveLength(1);
  });

  it("keeps binary images of a project", async () => {
    const p = { ...createProject({ id: "i", name: "Img", now: 1 }), assets: [{ name: "c.png", mime: "image/png", data: new Uint8Array([9, 8, 7]) }] };
    await putProject(p);
    expect((await getProject("i"))?.assets[0].data).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("upgrades a version 1 database and keeps the saved folder handle", async () => {
    await makeV1({ name: "my-notes" });
    expect(await getHandle("folder")).toEqual({ name: "my-notes" });
    expect(await listProjects()).toEqual([]);
    await putProject(createProject({ id: "x", name: "After upgrade", now: 1 }));
    expect(await getHandle("folder")).toEqual({ name: "my-notes" });
    expect((await listProjects()).map((p) => p.id)).toEqual(["x"]);
  });

  it("stores and replaces the folder handle", async () => {
    expect(await getHandle("folder")).toBeUndefined();
    await setHandle("folder", { name: "one" });
    await setHandle("folder", { name: "two" });
    expect(await getHandle("folder")).toEqual({ name: "two" });
  });
});
