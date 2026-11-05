import { describe, expect, it } from "vitest";
import { ReactContextOptionsError, reactContext } from "../src/index.js";
import { parseOptions } from "../src/provider-missing/options.js";

function problemsOf(options: unknown): string {
  try {
    parseOptions(options);
  } catch (error) {
    if (error instanceof ReactContextOptionsError) return error.message;
    throw error;
  }
  return "";
}

describe("reactContext options", () => {
  it("still works with no options, an empty object and no entries", () => {
    expect(reactContext().name).toBe("react-context");
    expect(reactContext({}).name).toBe("react-context");
    expect(parseOptions(undefined)).toEqual([]);
    expect(parseOptions({ entries: [] })).toEqual([]);
  });

  it("normalises a configured entry", () => {
    expect(
      parseOptions({ entries: [{ file: ".\\src\\App.tsx", export: "App", provides: ["Theme"] }] }),
    ).toEqual([{ file: "src/App.tsx", export: "App", provides: ["Theme"] }]);
    expect(parseOptions({ entries: [{ file: "src/App.tsx", export: "default" }] })).toEqual([
      { file: "src/App.tsx", export: "default", provides: [] },
    ]);
  });

  it.each([
    ["a string", "src/App.tsx", "the options must be an object"],
    ["an array", [], "the options must be an object"],
    ["null", null, "the options must be an object"],
    ["an unknown option", { entry: [] }, "options.entry is not an option; the options are entries"],
    ["entries that is not a list", { entries: {} }, "options.entries must be a list"],
    [
      "an entry that is not an object",
      { entries: ["src/App.tsx"] },
      "entries[0] must be an object",
    ],
    ["a missing file", { entries: [{ export: "App" }] }, "entries[0].file must be a path"],
    [
      "a missing export",
      { entries: [{ file: "a.tsx" }] },
      'entries[0].export must be the exported name, or "default"',
    ],
    [
      "an absolute file",
      { entries: [{ file: "/a.tsx", export: "A" }] },
      "entries[0].file must be relative",
    ],
    [
      "a parent path",
      { entries: [{ file: "../a.tsx", export: "A" }] },
      "entries[0].file must be relative",
    ],
    [
      "provides that is not names",
      { entries: [{ file: "a.tsx", export: "A", provides: [1] }] },
      "entries[0].provides must be a list",
    ],
    [
      "an unknown entry key",
      { entries: [{ file: "a.tsx", export: "A", name: "x" }] },
      "entries[0].name is not an option",
    ],
  ])("refuses %s with a named error", (_name, options, expected) => {
    const message = problemsOf(options);
    expect(message).toContain("invalid react-context options");
    expect(message).toContain(expected);
    const args: unknown[] = [options];
    expect(() => {
      Reflect.apply(reactContext, undefined, args);
    }).toThrow(ReactContextOptionsError);
  });

  it("names every problem at once", () => {
    const message = problemsOf({ entries: [{ file: 1 }, { export: "A" }] });
    expect(message).toContain("entries[0].file");
    expect(message).toContain("entries[0].export");
    expect(message).toContain("entries[1].file");
  });
});
