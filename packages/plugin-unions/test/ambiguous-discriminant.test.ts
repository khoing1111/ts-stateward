import { describe, expect, it } from "vitest";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "ambiguous-discriminant";

function weak(property: string, plain: string, alias: string): string {
  return `\`${property}\` does not tell the members of \`${alias}\` apart: one member has \`${plain}\``;
}

/** The two decisions (M22): the catch-all member gets its own tag, or the union is allowed open. */
function fix(alias: string, member: string): string {
  return [
    "one of",
    "- give the catch-all member its own tag, and keep the original value in another field:",
    `    ${member}`,
    "- or, when the union is open on purpose (data from a server you do not control), allow it:",
    `    ignore: ["${alias}"] in the rule's options`,
  ].join("\n");
}

function expected(
  property: string,
  plain: string,
  alias: string,
  member: string,
): ReturnType<typeof says> {
  return says("events.ts", weak(property, plain, alias), fix(alias, member));
}

describe(`unions/${RULE}: flagged`, () => {
  it("names the property, the literal, the plain type and the union", () => {
    expect(shown(checkOnly(fixture(`${RULE}/flagged`), RULE))).toEqual([
      expected("kind", "string", "Event", '| { kind: "other"; rawKind: string; raw: unknown }'),
      expected("level", "number", "Reading", '| { level: "other"; rawLevel: number }'),
      expected("tag", "string", "Shape", '| { tag: "other"; rawTag: string }'),
      expected("a", "string", "Both", '| { a: "other"; rawA: string; b: number }'),
      expected("b", "number", "Both", '| { a: string; b: "other"; rawB: number }'),
      // `"other"` is a member's tag already.
      expected("kind", "string", "Quoted", '| { kind: "unknown"; rawKind: string }'),
      expected("type", "string", "Msg", '| { type: "other"; rawType: string }'),
      expected("delta", "number", "Neg", '| { delta: "other"; rawDelta: number }'),
      expected("kind", "string", "Later", '| { kind: "other"; rawKind: string }'),
      expected("kind", "string", "Inner", '| { kind: "other"; rawKind: string }'),
      expected(
        "depth",
        "number",
        "ShapedNarrowed",
        '| { kind: "child"; depth: "other"; rawDepth: number; parentId: string }',
      ),
      expected(
        "level",
        "number",
        "ShapedLevel",
        '| { kind: "child"; level: "other"; rawLevel: number; parentId: string }',
      ),
      expected(
        "depth",
        "number",
        "ShapedTurn",
        '| { kind: "run"; depth: "other"; rawDepth: number; runId: string }',
      ),
    ]);
  });

  it("never cuts a name, so a long one makes the headline longer than 100, and the example shorter", () => {
    expect(shown(checkOnly(fixture(`${RULE}/long-names`), RULE))).toEqual([
      says(
        "events.ts",
        "`aVeryLongPropertyNameForTheKindOfMessage` does not tell the members of `UploadPipelineProgressMessageFromTheServer` apart: one member has `string`",
        fix(
          "UploadPipelineProgressMessageFromTheServer",
          '| { aVeryLongPropertyNameForTheKindOfMessage: "other"; … }',
        ),
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
