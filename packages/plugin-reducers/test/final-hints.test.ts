import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import type { Finding } from "@stateward/core";
import { check, exampleBlocks, fixture, inCopy, shown } from "./helpers.js";

const DIR = fixture("graph/door");
const FILE = `${DIR}/door.ts`;
const RULE = "reducers/state-cannot-leave";
const ofRule = (dir: string, options: Record<string, string[]> = {}): readonly Finding[] =>
  check(dir, { [RULE]: ["warning", options] }).filter((one) => one.ruleId === RULE);

const [found] = shown(DIR, ofRule(DIR));

describe(`${RULE}: the ways to mark a dead end final`, () => {
  it("shows the `@final` comment to write above the type, and the option as it is written", () => {
    expect(found?.message).toBe('`door` reaches "locked" but never leaves it');
    expect(found?.hint).toBe(
      [
        "one of",
        '- handle an event that leaves "locked", so a case returns another state',
        "- or mark it final, above `DoorState` (quick fix):",
        '    /** @final "locked" */',
        "- or, to treat it as final in every reducer, list it under the rule's `finalStates` option:",
        '    { finalStates: ["locked"] }',
      ].join("\n"),
    );
    // The old line told to use a quick fix without saying what it writes.
    expect(found?.hint).not.toContain("quick fix available");
  });

  it("the comment as shown, above the type, compiles and silences the finding", () => {
    const [block] = exampleBlocks(found?.hint ?? "");
    expect(block).toEqual(['/** @final "locked" */']);
    const text = readFileSync(FILE, "utf8");
    const start = text.indexOf("export type DoorState");
    const edit = { file: FILE, start, end: start, text: `${block?.[0] ?? ""}\n` };
    inCopy(DIR, [edit], (copy) => {
      expect(typeErrors(copy)).toBe("");
      expect(ofRule(copy)).toEqual([]);
    });
  });

  it("the option as shown silences the finding", () => {
    const line = exampleBlocks(found?.hint ?? "")[1]?.[0] ?? "";
    const written: unknown = JSON.parse(line.replace("finalStates", '"finalStates"'));
    expect(written).toEqual({ finalStates: ["locked"] });
    // The same option, given to the rule.
    expect(ofRule(DIR, { finalStates: ["locked"] })).toEqual([]);
  });
});
