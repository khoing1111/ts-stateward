import { describe, expect, it } from "vitest";
import { toTypeScriptPath, tsconfigDirectory } from "../src/internal.js";

describe("the form of a path given to TypeScript", () => {
  it("turns Windows backslashes into forward slashes", () => {
    expect(toTypeScriptPath("C:\\work\\app\\tsconfig.json")).toBe("C:/work/app/tsconfig.json");
  });

  it("leaves a path that is already in TypeScript's form alone", () => {
    expect(toTypeScriptPath("C:/work/app/tsconfig.json")).toBe("C:/work/app/tsconfig.json");
  });

  it("finds the folder of a tsconfig named with backslashes, in the same form", () => {
    // TypeScript asserts the config's name equals the one it is given: `C:/…` against `C:\…`
    // was the "Debug Failure" an invalid tsconfig produced on Windows.
    expect(tsconfigDirectory("C:\\work\\app\\tsconfig.json")).toBe("C:/work/app");
    expect(tsconfigDirectory("C:/work/app/tsconfig.json")).toBe("C:/work/app");
  });
});
