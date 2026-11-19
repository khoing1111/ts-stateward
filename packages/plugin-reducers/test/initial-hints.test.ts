import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { check, exampleBlocks, fixture, inCopy, shown } from "./helpers.js";

const DIR = fixture("graph/unreadable");
const RULE = "reducers/reducer-not-readable";
const ofRule = (dir: string): readonly Finding[] =>
  check(dir, { [RULE]: ["info", {}] }).filter((one) => one.ruleId === RULE);

const hintFor = (file: string, text: string): string => {
  const one = shown(DIR, ofRule(DIR)).find((s) => s.file === file && s.message.includes(text));
  if (one === undefined) throw new Error(`no finding in ${file} for ${text}`);
  return one.hint;
};

/** The hint's `@initial` line written above the reducer's declaration, as a developer would. */
const writeAbove = (file: string, reducer: string, hint: string) => {
  const path = `${DIR}/${file}`;
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(`export function ${reducer}`);
  const [block] = exampleBlocks(hint);
  expect(block).toHaveLength(1);
  return { file: path, start, end: start, text: `${block?.[0] ?? ""}\n` };
};

describe(`${RULE}: the start the reducer can have is listed with quoted states`, () => {
  it.each([
    ["queue.ts", "queueReducer", "no start is known"],
    ["search.ts", "searchReducer", "also used outside"],
    ["session.ts", "sessionReducer", "the state it starts from is not known"],
  ])(
    "%s: the `@initial` line of the hint silences the finding, quoted and with words",
    (file, reducer, text) => {
      const hint = hintFor(file, text);
      expect(hint).toContain("the states it can start in, above");
      expect(hint).toMatch(/\/\*\* @initial "[a-z]+" \*\//);
      expect(hint).not.toMatch(/@initial [a-z]/);
      expect(hint).not.toContain("to the reducer");
      inCopy(DIR, [writeAbove(file, reducer, hint)], (copy) => {
        expect(
          shown(copy, ofRule(copy))
            .filter((one) => one.file === file && one.at === reducer)
            .map((one) => one.message),
        ).toEqual([]);
      });
    },
  );

  it("the old texts are gone", () => {
    for (const [file, text] of [
      ["queue.ts", "no start is known"],
      ["session.ts", "the state it starts from is not known"],
    ] as const) {
      const hint = hintFor(file, text);
      expect(hint).not.toContain("/** @initial empty */");
      expect(hint).not.toContain("list where it starts with `@initial` on the reducer");
    }
    expect(hintFor("search.ts", "also used outside")).not.toContain("list its starts with");
  });

  it("`@initial` on a reducer started from data the program does not know covers that start", () => {
    // `useReducer(light, start)` with `/** @initial "red" */` on `light`.
    const hint = hintFor("session.ts", "the state it starts from is not known");
    inCopy(DIR, [writeAbove("session.ts", "sessionReducer", hint)], (copy) => {
      const left = shown(copy, ofRule(copy)).filter((one) => one.file === "session.ts");
      expect(left).toEqual([]);
    });
  });
});
