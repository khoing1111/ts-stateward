import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./lookup-helpers.js";

const RULE = "lookup-misses-key";

function unchecked(_map: string, _type: string, access: string): string {
  return `\`${access}\` can be missing, but its type says it never is`;
}

function declare(map: string, key: string): string {
  return `declare \`${map}\` with \`satisfies Record<…>\` over its real keys, or type \`${key}\` so a missing key is handled`;
}

/** A constant key on a record with no fixed keys: type its keys, there is no entry to add. */
function registry(map: string, key: string): string {
  return `give \`${map}\` its real keys (\`Record<${key} | …, …>\`), or handle a missing entry with \`?.\` or \`??\``;
}

function inFile(name: string): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE).filter((f) => f.location.file.endsWith(name));
}

describe(`records/${RULE}: flagged`, () => {
  it("says an index signature is never checked, and does not list keys the map has", () => {
    expect(shown(inFile("records.ts"))).toEqual([
      says(
        "records.ts",
        unchecked("labels", "Record<string, string>", "labels[status]"),
        declare("labels", "status"),
      ),
      says(
        "records.ts",
        unchecked("partial", "{ [key: string]: string; idle…", "partial[status]"),
        declare("partial", "status"),
      ),
      says(
        "records.ts",
        unchecked("labels", "Record<string, string>", "labels[job.kind]"),
        declare("labels", "job.kind"),
      ),
      says(
        "records.ts",
        unchecked("labels", "Record<string, string>", "labels[ status ]"),
        declare("labels", "status"),
      ),
    ]);
  });

  it("covers enum keys, number keys, long lists, generic keys; a constant key on an open record asks for typed keys", () => {
    expect(shown(inFile("other-keys.ts"))).toEqual([
      says(
        "other-keys.ts",
        unchecked("names", "Record<string, string>", "names[color]"),
        declare("names", "color"),
      ),
      says(
        "other-keys.ts",
        unchecked("sizes", "Record<number, string>", "sizes[level]"),
        declare("sizes", "level"),
      ),
      says(
        "other-keys.ts",
        unchecked("names", "Record<string, string>", "names[word]"),
        declare("names", "word"),
      ),
      says(
        "other-keys.ts",
        unchecked("map", "Record<string, string>", "map[key]"),
        declare("map", "key"),
      ),
      says(
        "other-keys.ts",
        unchecked("names", "Record<string, string>", 'names["only"]'),
        registry("names", '"only"'),
      ),
      says(
        "other-keys.ts",
        unchecked("names", "Record<string, string>", "names[color]"),
        declare("names", "color"),
      ),
      says(
        "other-keys.ts",
        unchecked("names", "Record<string, string>", "names[color]"),
        declare("names", "color"),
      ),
      says(
        "other-keys.ts",
        unchecked("sizes", "Record<number, string>", "sizes[3]"),
        registry("sizes", "3"),
      ),
      says(
        "other-keys.ts",
        unchecked("names", "Record<string, string>", "names[Color.Blue]"),
        registry("names", "Color.Blue"),
      ),
    ]);
  });

  it("asks to type the keys of a registry, and names the cast that hides them", () => {
    expect(shown(inFile("registry.ts"))).toEqual([
      says(
        "registry.ts",
        unchecked("actions", "Record<string, Action>", 'actions["zoom-in"]'),
        'give `actions` its real keys (`Record<"zoom-in" | …, …>`), or handle a missing entry with `?.` or `??`',
      ),
      says(
        "registry.ts",
        '`(response as Record<string, number>)["total_users"]` can be missing, but the cast to `Record<string, number>` says it never is',
        "type `response` where it is made, or handle a missing entry with `??`: the cast drops which keys it has",
      ),
    ]);
  });

  it("reads that a guard on another key, another map, or the wrong branch does not cover", () => {
    expect(shown(inFile("not-guarded.ts")).map((one) => one.message)).toEqual(
      Array.from({ length: 8 }, () =>
        unchecked("labels", "Record<string, string>", "labels[status]"),
      ),
    );
  });

  it("never cuts a name, so a long one makes the headline longer than 100", () => {
    const messages = shown(inFile("long-names.ts")).map((one) => one.message);
    expect(messages).toEqual([
      "`labelsForEveryStatusOfTheUploadPipelineInTheApp[theCurrentStatusOfTheUploadPipelineInTheApp]` can be missing, but its type says it never is",
      "`exactLabelsForEveryStatusOfTheUploadPipeline[theCurrentStatusOfTheUploadPipelineInTheApp]` can be missing, but its type says it never is",
    ]);
  });

  it("is an error on the access, without a quick fix", () => {
    const [first] = checkOnly(fixture(`${RULE}/flagged`), RULE);
    expect(first).toMatchObject({
      kind: "problem",
      ruleId: `records/${RULE}`,
      severity: "error",
      related: [],
      fixes: [],
    });
  });
});

describe(`records/${RULE}: not flagged`, () => {
  it("accepts complete maps, optional keys, undefined values, writes, arrays and handled reads", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });

  it("accepts an access that noUncheckedIndexedAccess types as possibly undefined", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged-unchecked`), RULE))).toEqual([]);
  });
});
