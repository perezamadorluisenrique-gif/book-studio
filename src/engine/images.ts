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
    let orientation = 1;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(bytes, i + 4, i + 2 + len);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = dv.getUint16(i + 5);
        const width = dv.getUint16(i + 7);
        // Orientations 5–8 turn the picture a quarter: what people see is the other way round.
        if (orientation >= 5) return { path, bytes, mime: "image/jpeg", height: width, width: height, orientation };
        return { path, bytes, mime: "image/jpeg", height, width, ...(orientation > 1 ? { orientation } : {}) };
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

/** The EXIF orientation tag (1–8) of an APP1 segment from `start` to `end`, or 1 when there is none. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  end = Math.min(end, bytes.length);
  if (end - start < 14 || String.fromCharCode(...bytes.subarray(start, start + 4)) !== "Exif") return 1;
  const t = start + 6; // TIFF header
  const le = bytes[t] === 0x49;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(t + 2) !== 42) return 1;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** The PDF matrix [a b c d e f] that draws a stored JPEG upright into the box (x, y is its bottom left). */
export function orientedMatrix(o: number, x: number, y: number, w: number, h: number): [number, number, number, number, number, number] {
  // For each orientation: how the displayed X and Y (0–1) follow the stored u (across) and v (up).
  const T: Record<number, number[]> = {
    1: [1, 0, 0, 0, 1, 0],
    2: [-1, 0, 1, 0, 1, 0],
    3: [-1, 0, 1, 0, -1, 1],
    4: [1, 0, 0, 0, -1, 1],
    5: [0, -1, 1, -1, 0, 1],
    6: [0, 1, 0, -1, 0, 1],
    7: [0, 1, 0, 1, 0, 0],
    8: [0, -1, 1, 1, 0, 0],
  };
  const [xu, xv, x0, yu, yv, y0] = T[o] ?? T[1];
  return [w * xu, h * yu, w * xv, h * yv, x + w * x0, y + h * y0];
}
