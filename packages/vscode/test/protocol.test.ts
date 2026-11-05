import { describe, expect, it } from "vitest";
import {
  UnexpectedAnswerError,
  parseChecking,
  parseNext,
  parsePlan,
  parseStatus,
} from "../src/protocol.js";

const row = { order: 1, ruleId: "a/b", group: "a/g", findings: 2, fixable: 1, protects: "p" };

describe("parseStatus", () => {
  it("reads a status with and without a current rule", () => {
    const on = {
      errors: 1,
      warnings: 0,
      infos: 2,
      baselined: 0,
      rollout: { on: true, current: { ruleId: "a/b", findings: 1 }, enabled: 1, total: 3 },
    };
    expect(parseStatus(on)).toEqual(on);
    const off = {
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: { on: false, enabled: 0, total: 0 },
    };
    expect(parseStatus(off)).toEqual(off);
  });

  it("keeps the config a status is for, and refuses one that is not a path", () => {
    const status = {
      configFile: "/repo/packages/a/stateward.config.ts",
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: { on: false, enabled: 0, total: 0 },
    };
    expect(parseStatus(status)).toEqual(status);
    expect(parseStatus({ ...status, configFile: 3 })).toBeUndefined();
  });

  it("keeps the mark that no rule is on", () => {
    const none = {
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 0,
      noRulesOn: true,
      rollout: { on: false, enabled: 0, total: 0 },
    };
    expect(parseStatus(none)).toEqual(none);
  });

  it("takes a server that sends no baselined count as having none baselined", () => {
    const old = { errors: 0, warnings: 0, infos: 0, rollout: { on: false, enabled: 0, total: 0 } };
    expect(parseStatus(old)).toEqual({ ...old, baselined: 0 });
  });

  it("refuses anything else", () => {
    expect(parseStatus(null)).toBeUndefined();
    expect(parseStatus({ errors: "1" })).toBeUndefined();
    expect(
      parseStatus({
        errors: 0,
        warnings: 0,
        infos: 0,
        baselined: 0,
        rollout: { on: true, current: 3, enabled: 0, total: 0 },
      }),
    ).toBeUndefined();
  });
});

describe("parsePlan and parseNext", () => {
  it("reads a plan", () => {
    expect(parsePlan({ rollout: true, enabled: ["a/b"], rules: [row] })).toEqual({
      rollout: true,
      enabled: ["a/b"],
      rules: [row],
    });
  });

  it("refuses a plan with a malformed rule", () => {
    expect(() =>
      parsePlan({ rollout: true, enabled: [], rules: [{ ...row, order: "1" }] }),
    ).toThrow(UnexpectedAnswerError);
    expect(() => parsePlan(null)).toThrow(UnexpectedAnswerError);
  });

  it("reads each kind of next answer and refuses an unknown one", () => {
    expect(parseNext({ kind: "blocked", message: "m" })).toEqual({ kind: "blocked", message: "m" });
    expect(() => parseNext({ kind: "later", message: "m" })).toThrow(UnexpectedAnswerError);
    expect(() => parseNext({ kind: "blocked" })).toThrow(UnexpectedAnswerError);
  });
});

describe("parseChecking", () => {
  it("reads which config's project check started or ended, and refuses anything else", () => {
    const started = { configFile: "/repo/stateward.config.ts", checking: true };
    expect(parseChecking(started)).toEqual(started);
    expect(parseChecking({ configFile: "/repo/stateward.config.ts", checking: "yes" })).toBe(
      undefined,
    );
    expect(parseChecking({ checking: false })).toBeUndefined();
    expect(parseChecking(null)).toBeUndefined();
  });
});
