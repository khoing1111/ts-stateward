import { describe, expect, it } from "vitest";
import { parseConfig } from "@stateward/core/internal";
import type { CheckResult, Config, Plugin } from "@stateward/core/internal";
import { statusReport } from "../src/adoption.js";

const plugin: Plugin = {
  name: "t",
  description: "t",
  rules: {
    rule: {
      kind: "file",
      meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },
      check() {
        return;
      },
    },
  },
};

function configOf(input: Record<string, unknown>): Config {
  const parsed = parseConfig({ plugins: [plugin], ...input }, "/work");
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

const empty: CheckResult = { findings: [], hidden: [], stats: { files: 1, durationMs: 0 } };

describe("statusReport", () => {
  it("marks a config that turns no rule on, so the status bar can say so", () => {
    expect(statusReport(configOf({}), empty).noRulesOn).toBe(true);
    expect(statusReport(configOf({ preset: "recommended" }), empty).noRulesOn).toBeUndefined();
    expect(
      statusReport(configOf({ rules: { "t/rule": "warning" } }), empty).noRulesOn,
    ).toBeUndefined();
  });
});
