// The browser's own storage (IndexedDB) for the web app: the remembered folder and the book projects.
// Version 1 only had "handles"; version 2 adds "projects" and version 3 adds "snapshots" (saved versions of a book).
// Each upgrade only adds what is missing, so everything saved before stays.

import type { Project } from "../project/model";
import { toPrune, type Snapshot } from "../project/snapshots";

export const DB_NAME = "book-studio";
export const DB_VERSION = 3;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // Only creates what is missing, so data saved by version 1 stays where it is.
      const db = req.result;
      if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "id" }).createIndex("projectId", "projectId");
    };
    req.onsuccess = () => {
      // If another tab upgrades the database later, let it go ahead.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

/** Run one request on one store and wait for it to be saved. */
async function run<T>(storeName: "handles" | "projects" | "snapshots", mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = make(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB failed"));
    });
  } finally {
    db.close();
  }
}

// ── The remembered folder ──

export async function getHandle<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>("handles", "readonly", (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export async function setHandle(key: string, value: unknown): Promise<void> {
  try {
    await run("handles", "readwrite", (s) => s.put(value, key));
  } catch {
    // Private windows may have no IndexedDB; the folder just isn't remembered.
  }
}

// ── Projects ──

/** All projects, the most recently changed first. */
export async function listProjects(): Promise<Project[]> {
  const all = await run<Project[]>("projects", "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): Promise<Project | undefined> {
  return run<Project | undefined>("projects", "readonly", (s) => s.get(id));
}

export async function putProject(p: Project): Promise<void> {
  await run("projects", "readwrite", (s) => s.put(p));
}

export async function deleteProject(id: string): Promise<void> {
  await run("projects", "readwrite", (s) => s.delete(id));
  // A deleted book takes its saved versions with it.
  for (const s of await listSnapshots(id)) await deleteSnapshot(s.id);
}

// ── Saved versions ──

/** The saved versions of one book, the newest first. */
export async function listSnapshots(projectId: string): Promise<Snapshot[]> {
  const all = await run<Snapshot[]>("snapshots", "readonly", (s) => s.index("projectId").getAll(projectId));
  return all.sort((a, b) => b.at - a.at);
}

/** Save a version and delete the oldest ones beyond the limit (automatic ones first). */
export async function putSnapshot(snap: Snapshot): Promise<void> {
  await run("snapshots", "readwrite", (s) => s.put(snap));
  for (const id of toPrune(await listSnapshots(snap.projectId))) await deleteSnapshot(id);
}

export async function deleteSnapshot(id: string): Promise<void> {
  await run("snapshots", "readwrite", (s) => s.delete(id));
}
