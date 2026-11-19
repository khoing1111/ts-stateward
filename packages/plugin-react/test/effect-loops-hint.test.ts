import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import type { Finding } from "@stateward/core";
import { check, exampleBlocks, fixture, inCopy, shown } from "./helpers.js";

const DIR = fixture("effect-loops-append");
const FILE = `${DIR}/Log.tsx`;
const RULE = "react/effect-loops";
const ofRule = (dir: string): readonly Finding[] => check(dir).filter((one) => one.ruleId === RULE);
const [found] = shown(DIR, ofRule(DIR));

describe(`${RULE}: an effect that appends to its own state`, () => {
  it("offers the updater written with the effect's own names, and says the state leaves the dependencies", () => {
    expect(found?.hint).toBe(
      [
        "one of",
        "- read the state through an updater, so the effect no longer depends on `log` (remove it from the dependencies):",
        "    setLog((current) => [...current, entry])",
        "- or set it only when it must change: put an `if` that compares the old and the new value around `setLog`",
        "- or make the change in the event that causes it",
      ].join("\n"),
    );
    // The old line wrote `if (…) setLog(…)`, with `…` for code the developer has.
    expect(found?.hint).not.toContain("if (…)");
  });

  it("the updater and the shorter dependency list, as shown, compile and stop the loop", () => {
    const [block] = exampleBlocks(found?.hint ?? "");
    const text = readFileSync(FILE, "utf8");
    const call = "setLog([...log, entry]);";
    const start = text.indexOf(call);
    const deps = text.indexOf("[log, entry]");
    inCopy(
      DIR,
      [
        { file: FILE, start, end: start + call.length, text: `${block?.[0] ?? ""};` },
        { file: FILE, start: deps, end: deps + "[log, entry]".length, text: "[entry]" },
      ],
      (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(ofRule(copy)).toEqual([]);
      },
    );
  });
});
