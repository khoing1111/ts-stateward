import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import { checkOnly, fixture, inCopy } from "./helpers.js";

const DIR = fixture("ambiguous-discriminant/flagged");
const SHAPE = 'export type Shape = { tag: "x" | "y" } | { tag: string };';

/** A function that switches on the tag of `Shape` and returns after the switch. */
const SWITCH_AFTER = `import type { Shape } from "./events.js";

export function area(s: Shape): number {
  switch (s.tag) {
    case "x":
      return 1;
  }
  return 0;
}
`;

describe("unions/ambiguous-discriminant: stating the union open", () => {
  const found = checkOnly(DIR, "ambiguous-discriminant");
  const shape = found.find((one) => one.message.includes("members of `Shape`"));
  const lines = (shape?.hint ?? "").split("\n").filter((line) => line.startsWith("    "));

  it("shows the import of `OpenUnion` with the path from the file to the guarantees file", () => {
    expect(lines).toContain('    import type { OpenUnion } from "./guarantees.js";');
    expect(lines.at(-1)).toBe(
      '    export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };',
    );
  });

  it("writes the guarantee as shown, and the union stated open compiles and is no longer reported", () => {
    const importLine = (lines.find((line) => line.includes("import type")) ?? "").trim();
    const guarantee = (lines.at(-1) ?? "").trim();
    const events = readFileSync(path.join(DIR, "events.ts"), "utf8");
    expect(events).toContain(SHAPE);
    const stated = events
      .replace(SHAPE, `export type Shape = OpenUnion<{ tag: "x" | "y" } | { tag: string }>;`)
      .replace(/^/, `${importLine}\n`);
    inCopy(DIR, { "events.ts": stated, "guarantees.ts": `${guarantee}\n` }, (copy) => {
      expect(typeErrors(copy)).toBe("");
      const after = checkOnly(copy, "ambiguous-discriminant").map((one) => one.message);
      expect(after).toHaveLength(found.length - 1);
      expect(after.some((message) => message.includes("members of `Shape`"))).toBe(false);
    });
  });
});

describe("unions/non-exhaustive-switch: a `switch` on the tag of an open union", () => {
  it("says it has no `default`, not that it handles nothing outside the union: a `return` after it does", () => {
    const events = readFileSync(path.join(DIR, "events.ts"), "utf8").replace(
      SHAPE,
      `export type Shape = OpenUnion<{ tag: "x" | "y" } | { tag: string }>;`,
    );
    inCopy(
      DIR,
      {
        "events.ts": `import type { OpenUnion } from "./guarantees.js";\n${events}`,
        "guarantees.ts":
          'export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };\n',
        "area.ts": SWITCH_AFTER,
      },
      (copy) => {
        expect(typeErrors(copy)).toBe("");
        const open = checkOnly(copy, "non-exhaustive-switch").filter((one) =>
          one.message.includes("outside"),
        );
        expect(open.map((one) => one.message)).toEqual([
          "`switch` on `s.tag` has no `default` for a value outside `Shape`, which is open",
        ]);
        expect(open.map((one) => one.message).join("")).not.toContain("does not handle");
      },
    );
  });
});
