import { describe, expect, it } from "vitest";
import { checkOnly, fixture, says, shown } from "./lookup-helpers.js";

const RULE = "duplicate-key";
const MAP_HINT = "remove the entry that should lose, or give it the key it was meant to have";
const SET_HINT = "remove the repeated item, or write the item that was meant here";

describe(`records/${RULE}: flagged`, () => {
  it("reports the second key with the line of the first", () => {
    expect(shown(checkOnly(fixture(`${RULE}/flagged`), RULE))).toEqual([
      says(
        "emoji.ts",
        '`"recent"` is in this Map twice; the second value replaces the first (line 9)',
        MAP_HINT,
      ),
      says(
        "emoji.ts",
        '`"recent"` is in this Map twice; the second value replaces the first (line 15)',
        MAP_HINT,
      ),
      says(
        "emoji.ts",
        "`Color.Red` is in this Map twice; the second value replaces the first (line 20)",
        MAP_HINT,
      ),
      says("emoji.ts", "`2` is in this Set twice; the repeat does nothing (line 25)", SET_HINT),
      says(
        "emoji.ts",
        '`"a"` is in this Map 3 times; the last value replaces the others (line 28)',
        MAP_HINT,
      ),
      says(
        "emoji.ts",
        '`"x"` is in this Map twice; the second value replaces the first (line 35)',
        MAP_HINT,
      ),
    ]);
  });

  it("points at the second key and lists the first as a related place, with no quick fix", () => {
    const [first] = checkOnly(fixture(`${RULE}/flagged`), RULE);
    expect(first).toMatchObject({
      kind: "problem",
      severity: "error",
      fixes: [],
      related: [{ message: 'the first "recent" is here' }],
    });
  });
});

describe(`records/${RULE}: not flagged`, () => {
  it('accepts distinct keys, "1" and 1, variable keys, spreads and a Map of your own', () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
