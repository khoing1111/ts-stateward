import { describe, expect, it } from "vitest";
import type { CheckResult, Finding } from "@stateward/core/internal";
import { fastPassLine, fullPassLine, longestStepLine } from "../src/report.js";

const location = { file: "/p/a.ts", start: 0, end: 1 };

function problem(severity: "error" | "warning" | "info"): Finding {
  return {
    kind: "problem",
    ruleId: "r/x",
    severity,
    message: "m",
    hint: "h",
    location,
    related: [],
    fixes: [],
  };
}

const result = (findings: Finding[], durationMs: number, files: number): CheckResult => ({
  findings,
  hidden: [],
  stats: { files, durationMs },
});

describe("check summary lines", () => {
  it("counts errors, warnings and infos; an unknown is an info and a failure a warning", () => {
    const findings: Finding[] = [
      problem("error"),
      problem("error"),
      problem("warning"),
      problem("info"),
      { kind: "unknown", ruleId: "r/x", message: "m", hint: "h", location },
      { kind: "failure", ruleId: "r/x", message: "m", hint: "h", location },
    ];
    expect(fullPassLine(result(findings, 1432, 3002))).toBe(
      "checked 3002 files in 1.4 s: 2 errors, 2 warnings, 2 infos",
    );
  });

  it("says zeros for a clean project", () => {
    expect(fullPassLine(result([], 40, 1))).toBe(
      "checked 1 files in 0.0 s: 0 errors, 0 warnings, 0 infos",
    );
  });

  it("names the file and the milliseconds for a fast pass", () => {
    expect(fastPassLine(["src/App.tsx"], result([], 38, 1))).toBe("checked src/App.tsx in 38 ms");
  });
});

describe("longestStepLine", () => {
  const cwd = "/p";
  it("says nothing for a step shorter than the threshold", () => {
    expect(longestStepLine({ ms: 120, at: undefined }, cwd)).toBeUndefined();
  });
  it("names the rule and the file of a slow file step, with /", () => {
    const at = {
      phase: "files",
      done: 3,
      total: 9,
      file: "/p/src/a.tsx",
      rule: "errors/x",
    } as const;
    expect(longestStepLine({ ms: 2900.4, at }, cwd)).toBe(
      "longest step 2900 ms: errors/x on src/a.tsx",
    );
  });
  it("names building the programs, a project rule and the last step", () => {
    expect(longestStepLine({ ms: 400, at: { phase: "files", done: 0, total: 9 } }, cwd)).toBe(
      "longest step 400 ms: building the programs",
    );
    expect(
      longestStepLine({ ms: 500, at: { phase: "project", done: 1, total: 3, rule: "r/p" } }, cwd),
    ).toBe("longest step 500 ms: r/p over the whole project");
    expect(longestStepLine({ ms: 350, at: undefined }, cwd)).toBe(
      "longest step 350 ms: finishing the project check",
    );
  });
});
