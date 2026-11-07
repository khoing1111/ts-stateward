import { describe, expect, it } from "vitest";
import type { RuleConfig } from "@stateward/core";
import { check, fixture } from "./helpers.js";

/*
 * Each option of the machines pack, shown changing what its rule reports. The default of
 * every option is today's behaviour, which the rule's own tests cover.
 */

/** `rule severity: headline` of each problem of `rule`. */
function lines(name: string, rule: string, config: RuleConfig = "warning"): string[] {
  return check(fixture(`graph/${name}`), { [`reducers/${rule}`]: config }).flatMap((finding) =>
    finding.kind === "problem" && finding.ruleId === `reducers/${rule}`
      ? [`${finding.severity}: ${finding.message}`]
      : [],
  );
}

describe("reducers/state-cannot-leave options", () => {
  it("`finalStates` makes a state final in every reducer", () => {
    expect(lines("checkout", "state-cannot-leave")).toHaveLength(1);
    expect(
      lines("checkout", "state-cannot-leave", ["warning", { finalStates: ["payment*"] }]),
    ).toEqual([]);
  });

  it("`severities` gives each kind of finding its own severity", () => {
    expect(
      lines("upload", "state-cannot-leave", [
        "warning",
        { severities: { "unknown-final": "error", "final-left": "info" } },
      ]),
    ).toEqual([
      'error: `@final` names "payed", which is not a state of `UploadState`',
      'info: "done" is marked final, but `uploadReducer` leaves it on `restart`',
    ]);
  });
});

describe("reducers/reducer-not-readable option `severities`", () => {
  it("turns off one kind and keeps the rest", () => {
    expect(lines("entry", "reducer-not-readable")).toHaveLength(1);
    expect(
      lines("entry", "reducer-not-readable", [
        "warning",
        { severities: { "may-start-anywhere": "off" } },
      ]),
    ).toEqual([]);
    const mixed = lines("unreadable", "reducer-not-readable", [
      "warning",
      { severities: { "unknown-initial": "error", "unquoted-tag": "info" } },
    ]);
    expect(mixed).toHaveLength(7);
    expect(mixed).toContain('error: `@initial` names "queud", which is not a state of `JobState`');
    expect(mixed).toContain("info: `@final` on `OrderState` lists states without quotes");
  });
});

describe("reducers/state-unreachable option `ignoreStates`", () => {
  it("never reports the states named", () => {
    expect(lines("upload", "state-unreachable", ["error", { ignoreStates: ["d*"] }])).toEqual([
      'error: `uploadReducer` never reaches "scheduled": only unreached "draft" leads to it',
    ]);
  });
});
