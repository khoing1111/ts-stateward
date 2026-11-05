import {
  RolloutError,
  advance,
  buildPlan,
  describeTurnOn,
  readRollout,
  ruleIsOn,
  writeRollout,
} from "@stateward/core/internal";
import type { CheckResult, Config, PlanRow } from "@stateward/core/internal";
import { countFindings, type Counts } from "./report.js";

export const STATUS_NOTIFICATION = "stateward/status";
export const PLAN_REQUEST = "stateward/plan";
export const NEXT_REQUEST = "stateward/next";
export const RECHECK_REQUEST = "stateward/recheck";

/** Where the project stands after a full pass: the counts and, with rollout on, the rule being fixed. */
export type StatusReport = Counts & {
  /** Findings the baseline accepts: not in the counts above. */
  baselined: number;
  /** Set when the config turns no rule on (a plugin alone turns nothing on). */
  noRulesOn?: true;
  rollout: {
    on: boolean;
    /** The rule turned on last and its findings; absent when rollout is off or no rule is on yet. */
    current?: { ruleId: string; findings: number };
    enabled: number;
    total: number;
  };
};

/** Whether the config turns any rule on, in itself or in an override. */
function anyRuleOn(config: Config): boolean {
  return config.plugins.some((plugin) =>
    Object.entries(plugin.rules).some(([key, rule]) =>
      ruleIsOn(config, plugin.name, key, rule.meta),
    ),
  );
}

/**
 * The status for a full pass of `config`. `result` is the configured pass, which has the findings
 * of every rule that is on, which is all the status needs: the current rule is one of them.
 */
export function statusReport(config: Config, result: CheckResult, baselined = 0): StatusReport {
  const counts = {
    ...countFindings(result),
    ...(anyRuleOn(config) ? {} : { noRulesOn: true as const }),
  };
  if (!config.rollout) {
    return { ...counts, baselined, rollout: { on: false, enabled: 0, total: 0 } };
  }
  const enabled = readRollout(config);
  const plan = buildPlan(config, result);
  const lastId = enabled.at(-1);
  const last = plan.rules.find((row) => row.ruleId === lastId);
  return {
    ...counts,
    baselined,
    rollout: {
      on: true,
      ...(last === undefined ? {} : { current: { ruleId: last.ruleId, findings: last.findings } }),
      enabled: enabled.length,
      total: plan.rules.length,
    },
  };
}

/** The answer to `stateward/plan`: the plan rows, in order, and where the rollout stands. */
export type PlanAnswer = {
  rollout: boolean;
  /** The rules turned on, in order; empty when rollout is off (every rule runs then). */
  enabled: readonly string[];
  rules: readonly PlanRow[];
};

/** `result` must come from a run of the `all` selection, like `stateward plan`. */
export function planAnswer(config: Config, result: CheckResult): PlanAnswer {
  return {
    rollout: config.rollout,
    enabled: config.rollout ? readRollout(config) : [],
    rules: buildPlan(config, result).rules,
  };
}

/** The answer to `stateward/next`. Every kind carries the text to show. */
export type NextAnswer =
  | { kind: "turned-on"; message: string }
  | { kind: "all-on"; message: string }
  /** The rule turned on last still has findings; asking again with `anyway` moves on. */
  | { kind: "blocked"; message: string }
  | { kind: "rollout-off"; message: string }
  /** The config cannot be used, a rule failed or the rollout file is broken. */
  | { kind: "failed"; message: string };

function countOf(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The `stateward/next` params are not `{ anyway?: boolean }`. */
export class InvalidNextParamsError extends Error {
  constructor() {
    super("stateward/next expects { anyway?: boolean }");
    this.name = "InvalidNextParamsError";
    Object.setPrototypeOf(this, InvalidNextParamsError.prototype);
  }
}

/** The `anyway` flag of the params; nothing sent means false. */
export function parseNextParams(params: unknown): boolean {
  if (params === null || params === undefined) return false;
  if (typeof params !== "object") throw new InvalidNextParamsError();
  if (!("anyway" in params)) return false;
  if (typeof params.anyway !== "boolean") throw new InvalidNextParamsError();
  return params.anyway;
}

/** What the editor tells the developer when the project has no rollout. */
export function rolloutOffAnswer(configFileName: string): NextAnswer {
  return {
    kind: "rollout-off",
    message: `Turn on \`rollout: true\` in ${configFileName} first: without it every rule runs, and there is no next rule to turn on.`,
  };
}

/**
 * What `stateward next` does: writes the rollout file through core's writer and says what it did
 * in the CLI's words. `result` must come from a run of the `all` selection. A rule that failed
 * makes the plan incomplete, so nothing is written then.
 */
export function applyNext(config: Config, result: CheckResult, anyway: boolean): NextAnswer {
  const failures = result.findings.filter((finding) => finding.kind === "failure");
  if (failures.length > 0) {
    return { kind: "failed", message: failures.map((finding) => finding.message).join("\n") };
  }
  try {
    const enabled = readRollout(config);
    const step = advance(buildPlan(config, result), enabled, anyway);
    switch (step.kind) {
      case "all-on":
        return {
          kind: "all-on",
          message: "Every rule is on; you can remove stateward.rollout.json and `rollout`.",
        };
      case "blocked":
        return {
          kind: "blocked",
          message: `\`${step.row.ruleId}\` still has ${countOf(step.row.findings, "finding")}; fix them, turn the next rule on anyway, or accept them with \`stateward baseline\` in a terminal.`,
        };
      case "turn-on": {
        // The rule with findings goes last: it is the one the next step waits on.
        const clean = step.clean.map((row) => row.ruleId);
        writeRollout(config, [
          ...enabled,
          ...clean,
          ...(step.row === undefined ? [] : [step.row.ruleId]),
        ]);
        return { kind: "turned-on", message: describeTurnOn(step).join("\n") };
      }
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  } catch (error) {
    if (error instanceof RolloutError) return { kind: "failed", message: error.message };
    throw error;
  }
}
