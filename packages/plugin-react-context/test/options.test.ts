import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding, OptionValue, RuleConfig } from "@stateward/core";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";

/*
 * Each option of the react-context pack, shown changing what its rule reports. The default
 * of every option is today's behaviour, which the rule's own tests cover.
 */

const pack = reactContext();
const RULES = ["fake-default-value", "provider-missing"] as const;

function findings(
  dir: string,
  rule: (typeof RULES)[number],
  options: Readonly<Record<string, OptionValue>>,
): readonly Finding[] {
  const rules: Record<string, RuleConfig> = {};
  for (const key of RULES)
    rules[`react-context/${key}`] = key === rule ? ["error", options] : "off";
  const found = checkFixture(dir, [pack], rules).findings;
  expectMessageStandard(found);
  return found;
}

/** `severity: headline` of each problem. */
function problems(...args: Parameters<typeof findings>): string[] {
  return findings(...args).flatMap((finding) =>
    finding.kind === "problem" ? [`${finding.severity}: ${finding.message}`] : [],
  );
}

const fixtures = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("react-context/fake-default-value options", () => {
  const dir = fixtures("flagged");
  it("`severities` sets a cast apart from an empty default", () => {
    const all = problems(dir, "fake-default-value", {});
    const mixed = problems(dir, "fake-default-value", { severities: { empty: "info" } });
    expect(mixed).toHaveLength(all.length);
    expect(mixed.filter((line) => line.startsWith("info")).length).toBeGreaterThan(0);
    expect(mixed.filter((line) => line.startsWith("error")).length).toBeGreaterThan(0);
    expect(
      problems(dir, "fake-default-value", { severities: { empty: "off", cast: "off" } }),
    ).toEqual([]);
  });

  it("`ignore` leaves out the contexts named", () => {
    const all = problems(dir, "fake-default-value", {});
    expect(problems(dir, "fake-default-value", { ignore: ["*"] })).toEqual([]);
    expect(problems(dir, "fake-default-value", { ignore: ["A", "B"] })).toHaveLength(
      all.length - 2,
    );
  });
});

describe("react-context/provider-missing option `ignore`", () => {
  it("does not report a missing Provider of the contexts named", () => {
    const dir = fixtures(path.join("provider-missing", "missing-two-contexts"));
    expect(problems(dir, "provider-missing", {})).toHaveLength(2);
    expect(problems(dir, "provider-missing", { ignore: ["ThemeCtx"] })).toEqual([
      "error: `<Profile>` is rendered without `AuthCtx.Provider`",
    ]);
  });
});
