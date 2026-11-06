// The front cover picture of a book project: what files are accepted, the size it needs for
// print, and how it is kept (an asset named cover.jpg or cover.png, named in the front matter's `cover:` line).

import { coverGeometry, coverPixels } from "../engine/cover/geometry";
import { trimById, TRIMS } from "../engine/trims";
import type { Project, ProjectAsset } from "./model";

/** Biggest cover file accepted. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export type CoverMime = "image/jpeg" | "image/png";

/** The kind of picture the bytes are, by their first bytes (the file name and the browser's guess can be wrong); null if not JPG or PNG. */
export function sniffImage(b: Uint8Array): CoverMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}

/** Width and height in pixels, read from the file header; null if it can't be read. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const kind = sniffImage(b);
  if (kind === "image/png") {
    if (b.length < 24) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (kind === "image/jpeg") {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Markers without a length: standalone ones and the restart markers.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = v.getUint16(i + 2);
      // Start-of-frame markers hold the size (not DHT 0xc4, JPG 0xc8, DAC 0xcc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** The pixels a front cover with bleed needs at 300 ppi for this trim size. */
export function frontCoverPixels(trimId: string): { width: number; height: number } {
  const trim = trimById(trimId) ?? TRIMS[0];
  const g = coverGeometry(trim, 24);
  return { width: Math.ceil(g.frontBleed.w * 300), height: coverPixels(g).height };
}

/** The cover asset of a project, if it has one. */
export function coverAsset(p: Project): ProjectAsset | undefined {
  const name = p.meta.cover?.trim();
  return name ? p.assets.find((a) => a.name === name) : undefined;
}

/** Use these bytes as the cover (the file type is checked by `sniffImage`). Replaces an earlier cover. */
export function setCover(p: Project, data: Uint8Array, mime: CoverMime, now: number): Project {
  const name = mime === "image/png" ? "cover.png" : "cover.jpg";
  const old = p.meta.cover?.trim();
  const assets = p.assets.filter((a) => a.name !== old && a.name !== name);
  assets.push({ name, mime, data });
  return { ...p, assets, meta: { ...p.meta, cover: name }, updatedAt: now };
}

export function removeCover(p: Project, now: number): Project {
  const old = p.meta.cover?.trim();
  const meta = { ...p.meta };
  delete meta.cover;
  return { ...p, assets: p.assets.filter((a) => a.name !== old), meta, updatedAt: now };
}
