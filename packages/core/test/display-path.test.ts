import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayPath, slashed } from "../src/display-path.js";

describe("slashed", () => {
  it("writes the separator of the system as /", () => {
    expect(slashed("src\\a\\b.ts", "\\")).toBe("src/a/b.ts");
    expect(slashed("src/a/b.ts", "/")).toBe("src/a/b.ts");
  });
});

describe("displayPath", () => {
  it("shows a Windows path relative to the folder, with / (path.win32)", () => {
    expect(displayPath("C:\\work\\app", "C:\\work\\app\\src\\status.ts", path.win32)).toBe(
      "src/status.ts",
    );
    expect(
      displayPath("C:\\work\\app", "C:\\work\\app\\.github\\workflows\\stateward.yml", path.win32),
    ).toBe(".github/workflows/stateward.yml");
    expect(displayPath("C:\\work\\app\\sub", "C:\\work\\app\\a.ts", path.win32)).toBe("../a.ts");
  });

  it("keeps the whole path, with /, when it is the folder itself or on another drive", () => {
    expect(displayPath("C:\\work", "C:\\work", path.win32)).toBe("C:/work");
    expect(displayPath("C:\\work", "D:\\other\\a.ts", path.win32)).toBe("D:/other/a.ts");
  });

  it("shows a POSIX path relative to the folder", () => {
    expect(displayPath("/work/app", "/work/app/src/status.ts", path.posix)).toBe("src/status.ts");
    expect(displayPath("/work/app", "/work/app", path.posix)).toBe("/work/app");
  });

  it("uses the running system's path by default", () => {
    expect(displayPath(path.resolve("a"), path.resolve("a", "b", "c.ts"))).toBe("b/c.ts");
  });
});
