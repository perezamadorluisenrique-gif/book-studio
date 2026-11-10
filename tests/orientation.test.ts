import { describe, expect, it } from "vitest";
import { imageInfo, orientedMatrix } from "../src/engine/images";

/** A JPEG header with an EXIF orientation tag and a SOF0 of the given stored size. */
function jpeg(width: number, height: number, orientation: number, littleEndian = true): Uint8Array {
  const e = littleEndian;
  const tiff = new DataView(new ArrayBuffer(26));
  tiff.setUint16(0, e ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, e);
  tiff.setUint32(4, 8, e);
  tiff.setUint16(8, 1, e); // one entry
  tiff.setUint16(10, 0x0112, e);
  tiff.setUint16(12, 3, e);
  tiff.setUint32(14, 1, e);
  tiff.setUint16(18, orientation, e);
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...new Uint8Array(tiff.buffer)];
  const app1Len = exif.length + 2;
  const sof = new DataView(new ArrayBuffer(19));
  sof.setUint16(0, 17);
  sof.setUint8(2, 8);
  sof.setUint16(3, height);
  sof.setUint16(5, width);
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 255, ...exif, 0xff, 0xc0, ...new Uint8Array(sof.buffer), 0, 0, 0, 0, 0, 0]);
}

describe("EXIF orientation", () => {
  it("leaves an upright JPEG alone", () => {
    const a = imageInfo("a.jpg", jpeg(400, 300, 1));
    expect(a).toMatchObject({ width: 400, height: 300 });
    expect(a?.orientation).toBeUndefined();
  });

  it.each([5, 6, 7, 8])("swaps width and height for orientation %i", (o) => {
    for (const le of [true, false]) {
      expect(imageInfo("a.jpg", jpeg(400, 300, o, le))).toMatchObject({ width: 300, height: 400, orientation: o });
    }
  });

  it.each([2, 3, 4])("keeps the size for orientation %i", (o) => {
    expect(imageInfo("a.jpg", jpeg(400, 300, o))).toMatchObject({ width: 400, height: 300, orientation: o });
  });

  it("ignores a bad orientation value", () => {
    expect(imageInfo("a.jpg", jpeg(400, 300, 9))?.orientation).toBeUndefined();
  });

  // Where the stored top-left corner (u=0, v=1) and bottom-left (u=0, v=0) land in a box at (10, 20) of 100 × 200.
  const at = (m: number[], u: number, v: number) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
  it("rotates a quarter turn clockwise for orientation 6", () => {
    const m = orientedMatrix(6, 10, 20, 100, 200);
    expect(at(m, 0, 1)).toEqual([110, 220]); // top-left goes to top-right
    expect(at(m, 0, 0)).toEqual([10, 220]); // bottom-left goes to top-left
  });
  it("rotates a quarter turn counter-clockwise for orientation 8", () => {
    const m = orientedMatrix(8, 10, 20, 100, 200);
    expect(at(m, 0, 1)).toEqual([10, 20]); // top-left goes to bottom-left
    expect(at(m, 1, 1)).toEqual([10, 220]); // top-right goes to top-left
  });
  it("turns upside down for orientation 3 and is the identity for 1", () => {
    expect(at(orientedMatrix(3, 10, 20, 100, 200), 0, 0)).toEqual([110, 220]);
    expect(orientedMatrix(1, 10, 20, 100, 200)).toEqual([100, 0, 0, 200, 10, 20]);
  });
});
