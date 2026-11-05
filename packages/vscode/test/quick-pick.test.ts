import { describe, expect, it } from "vitest";
import { COMMANDS, actionItems, planItems, ruleItems } from "../src/quick-pick.js";

const rules = [
  {
    order: 1,
    ruleId: "guards/a",
    group: "guards/switches",
    findings: 4,
    fixable: 3,
    protects: "a new case is not missed",
  },
  {
    order: 2,
    ruleId: "states/b",
    group: "states/records",
    findings: 1,
    fixable: 0,
    protects: "keys are known",
  },
];

describe("quick pick items", () => {
  it("lists the plan in order: rule, findings, fixable and what it protects", () => {
    expect(planItems(rules)).toEqual([
      {
        ruleId: "guards/a",
        label: "1. switches · a",
        description: "4 findings, 3 fixable",
        detail: "a new case is not missed",
      },
      {
        ruleId: "states/b",
        label: "2. records · b",
        description: "1 finding, 0 fixable",
        detail: "keys are known",
      },
    ]);
  });

  it("lists rule ids to explain", () => {
    expect(ruleItems(rules).map((item) => item.label)).toEqual(["guards/a", "states/b"]);
  });

  it("offers the four actions, each with its registered command", () => {
    expect(actionItems().map((item) => [item.label, item.command])).toEqual([
      ["Show the rule plan", COMMANDS.plan],
      ["Turn on the next rule", COMMANDS.next],
      ["Explain a rule…", COMMANDS.explain],
      ["Re-check now", COMMANDS.recheck],
    ]);
  });
});
