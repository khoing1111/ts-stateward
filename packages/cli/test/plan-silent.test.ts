import { describe, expect, it } from "vitest";
import type { PlanRow } from "@stateward/core/internal";
import { buildPlanReport, formatPlanPretty } from "../src/plan.js";

const row = (ruleId: string, silent?: string): PlanRow => ({
  order: 1,
  ruleId,
  group: "errors/render",
  tier: "core",
  findings: 0,
  fixable: 0,
  protects: "p",
  ...(silent === undefined ? {} : { silent }),
});

describe("stateward plan", () => {
  it("prints one reason line under a rule that is on but silent", () => {
    const report = buildPlanReport(
      {
        rules: [
          row("errors/render-throw-without-boundary", "your app's root has an error boundary"),
          row("errors/other"),
        ],
      },
      false,
      [],
    );
    const lines = formatPlanPretty(report).split("\n");
    const at = lines.findIndex((line) => line.includes("errors/render-throw-without-boundary"));
    expect(lines[at + 1]).toBe("    silent: your app's root has an error boundary");
    expect(lines.filter((line) => line.includes("silent:"))).toHaveLength(1);
  });
});

describe("stateward plan: rules that could not run", () => {
  it("says why under the rule and never calls it clean", () => {
    const reason = "React's types are not installed (install the app's dependencies)";
    const report = buildPlanReport(
      { rules: [{ ...row("react/effect-loops"), notChecked: reason }, row("unions/x")] },
      true,
      [],
    );
    const lines = formatPlanPretty(report).split("\n");
    const at = lines.findIndex((line) => line.includes("react/effect-loops"));
    expect(lines[at]).not.toContain("turns on clean");
    expect(lines[at + 1]).toBe(`    not checked: ${reason}`);
    expect(lines.find((line) => line.includes("unions/x"))).toContain("turns on clean");
  });
});
