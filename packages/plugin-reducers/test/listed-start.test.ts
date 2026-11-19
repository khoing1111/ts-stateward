import { describe, expect, it } from "vitest";
import { check, fixture, shown } from "./helpers.js";

const DIR = fixture("graph/listed-start");
const RULE = "reducers/reducer-not-readable";

describe(`${RULE}: a start that the reducer's \`@initial\` does not list`, () => {
  const found = shown(DIR, check(DIR, { [RULE]: ["info", {}] })).filter((one) => one.rule === RULE);

  it("says which state `useReducer` starts in, and that `@initial` does not list it", () => {
    expect(found.map((one) => [one.file, one.message, one.hint, one.notes])).toEqual([
      [
        "light.ts",
        '`useReducer` starts `light` in "yellow", which `@initial` does not list',
        'list it, quoted: `@initial "red" | "yellow"`, or start the reducer in a state `@initial` lists',
        ['light.ts: @initial "red": `@initial` is stated here'],
      ],
    ]);
  });

  it("is silent for a start that `@initial` lists", () => {
    expect(found.filter((one) => one.file === "ok.ts")).toEqual([]);
  });
});
