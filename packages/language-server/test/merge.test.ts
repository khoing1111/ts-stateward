import { describe, expect, it } from "vitest";
import type { Finding, HiddenFindings } from "@stateward/core/internal";
import { mergeFastPass } from "../src/merge.js";

const FILE = "/p/src/a.ts";
const OTHER = "/p/src/b.ts";

function problem(ruleId: string, file: string, start: number): Finding {
  return {
    kind: "problem",
    ruleId,
    severity: "error",
    message: `${ruleId}@${String(start)}`,
    hint: "h",
    location: { file, start, end: start + 1 },
    related: [],
    fixes: [],
  };
}

const none: HiddenFindings[] = [];

describe("mergeFastPass", () => {
  it("keeps the fast pass's findings of that file only, ordered by position then rule id", () => {
    const fast = {
      findings: [
        problem("guards/z", FILE, 9),
        problem("guards/a", FILE, 3),
        problem("guards/b", FILE, 1),
        problem("guards/other", OTHER, 2),
      ],
      hidden: none,
    };
    expect(mergeFastPass({ file: FILE, fast }).findings.map((f) => f.ruleId)).toEqual([
      "guards/b",
      "guards/a",
      "guards/z",
    ]);
  });

  it("carries no project-rule finding of the edited file: they come back with the full pass", () => {
    // The old behaviour kept `records/ambiguous-table@40` at its old offset, drawn mid-line after an edit.
    const fast = { findings: [problem("guards/new", FILE, 10)], hidden: none };
    const merged = mergeFastPass({ file: FILE, fast });
    expect(merged.findings.map((f) => f.message)).toEqual(["guards/new@10"]);
    expect(merged.hidden).toEqual([]);
  });

  it("keeps the hidden counts of that file, ordered by rule id", () => {
    const fast = {
      findings: [],
      hidden: [
        { file: FILE, ruleId: "b/r", count: 2 },
        { file: OTHER, ruleId: "a/r", count: 9 },
        { file: FILE, ruleId: "a/r", count: 1 },
      ],
    };
    expect(mergeFastPass({ file: FILE, fast }).hidden).toEqual([
      { file: FILE, ruleId: "a/r", count: 1 },
      { file: FILE, ruleId: "b/r", count: 2 },
    ]);
  });
});
