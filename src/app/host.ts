// What the studio needs from the app it runs in: the Obsidian plugin or the web app.

import type { VaultSource } from "../engine/book";
import type { FontLoader } from "../engine/fonts";
import type { HttpPost } from "../engine/license";
import type { SourceRef } from "../engine/model";

export interface BookChoice {
  path: string;
  title: string;
}

/** Small persistent key-value storage; hosts save it however they like. */
export interface Store {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export interface OutputFile {
  name: string;
  mime: string;
  data: Uint8Array | string;
}

export interface Dialog {
  title: string;
  message: string;
  ok: string;
  cancel?: string;
  /** An extra button; resolves to "extra". */
  extra?: string;
}

export interface StudioHost {
  kind: "obsidian" | "web";
  /** The open vault or folder, or null before one is chosen. */
  source(): VaultSource | null;
  listBooks(): Promise<BookChoice[]>;
  loadFont: FontLoader;
  /** Save an output; resolves to a message saying where, or null if cancelled. */
  save(file: OutputFile): Promise<string | null>;
  http: HttpPost;
  store: Store;
  ask(dialog: Dialog): Promise<"ok" | "cancel" | "extra">;
  notify(message: string): void;
  openUrl(url: string): void;
  /** Open a note at a line, where the host can. */
  openSource?(src: SourceRef): void;
  /** Open the host's license settings. */
  openLicense(): void;
  /** Name for this device's license activation, e.g. "Obsidian". */
  activationLabel: string;
  /** A stable name for a book across sessions, e.g. folder name plus path; defaults to the path. */
  bookKey?(path: string): string;
  /** The open book is the bundled sample, which doesn't count as the free plan's book. */
  isSample?(): boolean;
  /** Fill the empty state shown before a folder or vault has a book. */
  renderEmpty?(container: HTMLElement): void;
}
