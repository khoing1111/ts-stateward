import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACK_CATALOG } from "../src/index.js";
import { PACK_FACTORIES } from "./packs.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The packages the CLI's package.json installs with it. */
function dependencies(): readonly string[] {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return isRecord(parsed) && isRecord(parsed.dependencies) ? Object.keys(parsed.dependencies) : [];
}

describe("the pack catalog", () => {
  it("says what each pack says of itself: its name and description", () => {
    for (const pack of PACK_CATALOG) {
      const factory = PACK_FACTORIES[pack.importName];
      expect(factory, `${pack.packageName} exports ${pack.importName}`).toBeTypeOf("function");
      const plugin = factory?.();
      expect(plugin?.name).toBe(pack.name);
      expect(plugin?.description).toBe(pack.description);
    }
  });

  it("lists every pack once", () => {
    expect(new Set(PACK_CATALOG.map((pack) => pack.name)).size).toBe(PACK_CATALOG.length);
    expect(Object.keys(PACK_FACTORIES).sort()).toEqual(
      PACK_CATALOG.map((pack) => pack.importName).sort(),
    );
  });

  it("is all the CLI needs: it depends on core only", () => {
    expect(dependencies()).toEqual(["@stateward/core"]);
  });
});
