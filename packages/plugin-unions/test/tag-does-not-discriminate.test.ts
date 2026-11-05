import { describe, expect, it } from "vitest";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "tag-does-not-discriminate";

function weak(property: string, literal: string, plain: string, alias: string): string {
  return `\`${property}\` is ${literal} in one member of \`${alias}\` but \`${plain}\` in another, so it cannot tell them apart`;
}

function fix(property: string, alias: string): string {
  return `give every member of \`${alias}\` its own literal \`${property}\`, or move the catch-all member out of the union`;
}

function expected(
  property: string,
  literal: string,
  plain: string,
  alias: string,
): ReturnType<typeof says> {
  return says("events.ts", weak(property, literal, plain, alias), fix(property, alias));
}

describe(`unions/${RULE}: flagged`, () => {
  it("names the property, the literal, the plain type and the union", () => {
    expect(shown(checkOnly(fixture(`${RULE}/flagged`), RULE))).toEqual([
      expected("kind", '"a"', "string", "Event"),
      expected("level", "1", "number", "Reading"),
      expected("tag", '"x"', "string", "Shape"),
      expected("a", '"x"', "string", "Both"),
      expected("b", "1", "number", "Both"),
      expected("kind", '"one"', "string", "Quoted"),
      expected("type", '"data"', "string", "Msg"),
      expected("delta", "-1", "number", "Neg"),
      expected("kind", '"last"', "string", "Later"),
      expected("kind", '"in"', "string", "Inner"),
      expected("depth", "0", "number", "ShapedNarrowed"),
      expected("level", "0", "number", "ShapedLevel"),
      expected("depth", "0", "number", "ShapedTurn"),
    ]);
  });

  it("never cuts a name or a literal, so a long one makes the line longer than 100", () => {
    expect(shown(checkOnly(fixture(`${RULE}/long-names`), RULE))).toEqual([
      says(
        "events.ts",
        '`aVeryLongPropertyNameForTheKindOfMessage` is "initialisingTheConnection" in one member of `UploadPipelineProgressMessageFromTheServer` but `string` in another, so it cannot tell them apart',
        "give every member of `UploadPipelineProgressMessageFromTheServer` its own literal `aVeryLongPropertyNameForTheKindOfMessage`, or move the catch-all member out of the union",
      ),
    ]);
  });

  it("is info under the default preset (a coverage rule), without a quick fix", () => {
    const [first] = checkOnly(fixture(`${RULE}/flagged`), RULE);
    expect(first).toMatchObject({
      kind: "problem",
      ruleId: `unions/${RULE}`,
      severity: "info",
      related: [],
      fixes: [],
    });
  });
});

describe(`unions/${RULE}: not flagged`, () => {
  it("accepts a weak property when another one tells every member apart and no code narrows on it (ShapedRow), or a test that only compares its value (TurnRow)", () => {
    const found = shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE));
    expect(
      found.filter((one) => one.message.includes("ShapedRow") || one.message.includes("TurnRow")),
    ).toEqual([]);
  });

  it("accepts literals everywhere, plain everywhere, other bases, members by name and non-unions", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });

  // a real project's `ShapedRow`, in both shapes it can have.
  it("accepts reads of a member-only property that `kind` narrows, after a `depth` test (shape a: `turn` only on the turn member)", () => {
    expect(shown(checkOnly(fixture(`${RULE}/shaped-row-a`), RULE))).toEqual([]);
  });

  it("accepts a property every member has, optional on some, read after a `depth` test (shape b)", () => {
    expect(shown(checkOnly(fixture(`${RULE}/shaped-row-b`), RULE))).toEqual([]);
  });
});
