import { describe, expect, it } from "vitest";
import { parseConfig } from "@stateward/core/internal";
import type { Config, Plugin } from "@stateward/core/internal";
import { InvalidExplainParamsError, answerExplain } from "../src/explain.js";

const plugin: Plugin = {
  name: "demo",
  description: "demo",
  rules: {
    thing: {
      kind: "file",
      meta: {
        description: "d",
        defaultSeverity: "error",
        tier: "core",
        group: "g",
        explain: "# demo/thing\n\nWhy.",
      },
      check: () => undefined,
    },
  },
};

function config(): Config {
  const parsed = parseConfig({ plugins: [plugin] }, "/p");
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

describe("answerExplain", () => {
  it("answers the rule's explain markdown", async () => {
    expect(await answerExplain(config(), { ruleId: "demo/thing" })).toBe("# demo/thing\n\nWhy.");
  });

  it("answers null for a rule id nobody has, and when there is no config", async () => {
    expect(await answerExplain(config(), { ruleId: "demo/other" })).toBeNull();
    expect(await answerExplain(undefined, { ruleId: "demo/thing" })).toBeNull();
  });

  it("refuses params that are not { ruleId: string }", async () => {
    for (const params of [undefined, null, "demo/thing", {}, { ruleId: 3 }]) {
      await expect(answerExplain(config(), params)).rejects.toThrow(InvalidExplainParamsError);
    }
  });
});
