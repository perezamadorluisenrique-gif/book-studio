import { describe, expect, it } from "vitest";
import { checkIsbn, displayIsbn, ean13CheckDigit, ean13Modules } from "../src/engine/cover/isbn";

describe("ISBN", () => {
  it("validates ISBN-13 check digits", () => {
    expect(checkIsbn("978-0-306-40615-7")).toEqual({ ok: true, isbn13: "9780306406157" });
    expect(checkIsbn("978 1 23456 789 7")).toEqual({ ok: true, isbn13: "9781234567897" });
    expect(checkIsbn("9780306406158")).toEqual({ ok: false, reason: "checksum" });
    expect(checkIsbn("1234567890123")).toEqual({ ok: false, reason: "checksum" });
    expect(checkIsbn("978030640615")).toEqual({ ok: false, reason: "format" });
    expect(checkIsbn("hello")).toEqual({ ok: false, reason: "format" });
  });

  it("rejects a valid EAN-13 that is not a book prefix", () => {
    const body = "590123412345";
    expect(checkIsbn(body + ean13CheckDigit(body))).toEqual({ ok: false, reason: "prefix" });
  });

  it("upgrades a valid ISBN-10 and refuses a bad one", () => {
    expect(checkIsbn("0-306-40615-2")).toEqual({ ok: true, isbn13: "9780306406157" });
    expect(checkIsbn("080442957X")).toEqual({ ok: true, isbn13: "9780804429573" });
    expect(checkIsbn("0306406153")).toEqual({ ok: false, reason: "checksum" });
  });

  it("prints the ISBN as the author hyphenated it, or as plain digits", () => {
    expect(displayIsbn("978-1-23456-789-7", "9781234567897")).toBe("978-1-23456-789-7");
    expect(displayIsbn("  978 1 23456 789 7 ", "9781234567897")).toBe("9781234567897");
    expect(displayIsbn("1-23456-789-5", "9781234567897")).toBe("9781234567897");
  });
});

describe("EAN-13 bars", () => {
  it("draws 95 modules with the standard guards", () => {
    const m = ean13Modules("9780306406157");
    expect(m).toHaveLength(95);
    expect(m.startsWith("101")).toBe(true);
    expect(m.slice(45, 50)).toBe("01010");
    expect(m.endsWith("101")).toBe(true);
  });

  it("matches the standard L, G and R code tables", () => {
    // Literal tables from the EAN-13 specification, written out separately from the encoder.
    const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
    const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
    const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
    const parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
    for (const n of ["9780306406157", "4006381333931", "5901234123457", "9781234567897"]) {
      let want = "101";
      for (let i = 0; i < 6; i++) want += (parity[Number(n[0])][i] === "L" ? L : G)[Number(n[1 + i])];
      want += "01010";
      for (let i = 0; i < 6; i++) want += R[Number(n[7 + i])];
      want += "101";
      expect(ean13Modules(n), n).toBe(want);
    }
  });

  it("refuses a number with a wrong check digit", () => {
    expect(() => ean13Modules("9780306406158")).toThrow();
  });
});
