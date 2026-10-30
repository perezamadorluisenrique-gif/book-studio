// Read pixel dimensions from PNG/JPEG headers without decoding the image.

import type { ImageAsset } from "./model";

export function imageInfo(path: string, bytes: Uint8Array): ImageAsset | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR colour type 4 (grey) and 6 (RGB) carry an alpha channel; a tRNS chunk adds one to the others.
    const alpha = bytes[25] === 4 || bytes[25] === 6 || hasChunk(bytes, "tRNS");
    return { path, bytes, mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20), alpha };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      const len = dv.getUint16(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { path, bytes, mime: "image/jpeg", height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

/** Whether a PNG has a chunk of this type before its image data. */
function hasChunk(bytes: Uint8Array, type: string): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i);
    const name = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    if (name === type) return true;
    if (name === "IDAT" || name === "IEND") return false;
    i += 12 + len;
  }
  return false;
}
