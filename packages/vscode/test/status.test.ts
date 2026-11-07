import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Status } from "../src/protocol.js";
import { WAITING_VIEW, checkingView, statusFor, statusView, statusViewFor } from "../src/status.js";

const off = (errors: number, warnings = 0): Status => ({
  errors,
  warnings,
  infos: 0,
  baselined: 0,
  rollout: { on: false, enabled: 0, total: 0 },
});

describe("statusView", () => {
  it("waits for the first check", () => {
    expect(statusView(undefined)).toBe(WAITING_VIEW);
  });

  it("says no rules are on, never a check mark, when the config turns none on", () => {
    expect(statusView({ ...off(0), noRulesOn: true }).text).toBe("Stateward: no rules on");
  });

  it("shows a check mark when rollout is off and nothing is an error", () => {
    expect(statusView(off(0)).text).toBe("$(check) Stateward");
  });

  it("shows the error count, with the warnings in the tooltip", () => {
    const view = statusView(off(3, 2));
    expect(view.text).toBe("$(error) Stateward: 3");
    expect(view.tooltip).toContain("3 errors, 2 warnings, 0 infos");
  });

  it("adds the baselined count to the tooltip, not to the counts that decide the icon", () => {
    const view = statusView({ ...off(0), baselined: 12 });
    expect(view.text).toBe("$(check) Stateward");
    expect(view.tooltip).toContain("0 errors, 0 warnings, 0 infos; 12 baselined");
  });

  it("shows the rollout: the rule turned on last and what is left", () => {
    const view = statusView({
      errors: 3,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: {
        on: true,
        current: { ruleId: "records/lookup-misses-key", findings: 3 },
        enabled: 2,
        total: 9,
      },
    });
    expect(view.text).toBe("Stateward: rule 2 of 9 · 3 left");
    expect(view.tooltip).toContain("records/lookup-misses-key");
    expect(view.tooltip).toContain("turn on the next rule");
  });

  it("says nothing is left, and offers the next rule plainly", () => {
    const view = statusView({
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: { on: true, current: { ruleId: "a/b", findings: 0 }, enabled: 1, total: 4 },
    });
    expect(view.text).toBe("Stateward: rule 1 of 4 · nothing left");
    expect(view.tooltip).toContain("Turn on the next rule.");
  });

  it("says no rule is on yet", () => {
    const view = statusView({
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: { on: true, enabled: 0, total: 4 },
    });
    expect(view.text).toBe("Stateward: 0 of 4 rules on");
    expect(view.tooltip).toContain("Turn on the next rule");
  });
});

describe("statusFor", () => {
  const root = path.resolve("/repo");
  const rootConfig = path.join(root, "stateward.config.ts");
  const nestedConfig = path.join(root, "packages", "a", "stateward.config.ts");
  const statuses = new Map<string, Status>([
    [rootConfig, { ...off(1), configFile: rootConfig }],
    [nestedConfig, { ...off(2), configFile: nestedConfig }],
  ]);
  const last = { ...off(9) };

  it("shows the status of the nearest config above the active file", () => {
    expect(statusFor(path.join(root, "packages", "a", "src", "a.ts"), statuses, last)?.errors).toBe(
      2,
    );
    expect(statusFor(path.join(root, "packages", "b", "b.ts"), statuses, last)?.errors).toBe(1);
  });

  it("shows the last status for no active file, or one outside every config", () => {
    expect(statusFor(undefined, statuses, last)).toBe(last);
    expect(statusFor(path.resolve("/elsewhere/c.ts"), statuses, last)).toBe(last);
  });

  it("names the config in the tooltip when given one", () => {
    expect(statusViewFor(off(0), "packages/a/stateward.config.ts").tooltip).toBe(
      "Stateward: 0 errors, 0 warnings, 0 infos. Click for actions. (packages/a/stateward.config.ts)",
    );
    expect(statusViewFor(off(0), undefined)).toEqual(statusView(off(0)));
  });
});

describe("checkingView", () => {
  it("says the project is being checked, keeping the last result in the tooltip", () => {
    const view = checkingView(statusView(off(1)));
    expect(view.text).toBe("$(sync~spin) Stateward: checking…");
    expect(view.tooltip).toBe(
      "Stateward is checking the project in the background; the open file's findings are up to date. Last result: Stateward: 1 error, 0 warnings, 0 infos. Click for actions.",
    );
  });
});
