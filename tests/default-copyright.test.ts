import { describe, expect, it } from "vitest";
import { defaultCopyright } from "../src/engine/book";

describe("defaultCopyright", () => {
  it("is English for English books", () => {
    expect(defaultCopyright("en", "2026", ["Ann"])).toBe("Copyright © 2026 Ann. All rights reserved.");
    expect(defaultCopyright("fr", "2026", [])).toBe("Copyright © 2026 the author. All rights reserved.");
  });
  it("is Spanish for es, es-MX and es_AR", () => {
    expect(defaultCopyright("es", "2026", ["Ana", "Luis"])).toBe("Copyright © 2026 Ana y Luis. Todos los derechos reservados.");
    expect(defaultCopyright("es-MX", "2026", [])).toBe("Copyright © 2026 el autor. Todos los derechos reservados.");
    expect(defaultCopyright("es_AR", "2026", ["Ana"])).toContain("Todos los derechos");
  });
});
