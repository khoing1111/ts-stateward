import { ruleIsOn } from "./severity.js";
import type { CheckResult, Config, RuleTier } from "./types.js";

/** One rule in the adoption plan. */
export type PlanRow = {
  /** 1-based place in the suggested order. */
  order: number;
  ruleId: string;
  /** The rule's group, as "<plugin>/<group>". */
  group: string;
  tier: RuleTier;
  findings: number;
  /** Findings with at least one quick fix. Findings past the per-file cap are not counted here. */
  fixable: number;
  /** The rule's one-line description: what it protects. */
  protects: string;
  /**
   * Why the rule is on but cannot report in this project (`ProjectRule.silentReason`), as the
   * phrase after "silent: "; left out when it can.
   */
  silent?: string;
};

export type Plan = { rules: readonly PlanRow[] };

const TIER_RANK: Readonly<Record<RuleTier, number>> = { core: 0, coverage: 1, addon: 2 };

type Candidate = Omit<PlanRow, "order"> & { packIndex: number };

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    a.findings - b.findings ||
    b.fixable - a.fixable ||
    a.packIndex - b.packIndex ||
    compareText(a.ruleId, b.ruleId)
  );
}

/**
 * The suggested order: core rules, then coverage, then add-ons; within a tier the fewest findings
 * first (a rule with nothing to fix costs nothing to turn on, and a big one never comes first:
 * beta feedback), then the most quick fixes, then the pack order of
 * the config, then the rule id. `result` must come from a run of the `all` selection. Rules the
 * config switches off are not in the plan: `next` never turns on what the developer turned off.
 */
export function buildPlan(
  config: Config,
  result: CheckResult,
  /** Reasons rules are silent, by rule id (`Checker.silentReasons`). */
  silent: ReadonlyMap<string, string> = new Map(),
): Plan {
  const findings = new Map<string, number>();
  const fixable = new Map<string, number>();
  const bump = (counts: Map<string, number>, ruleId: string, by: number): void => {
    counts.set(ruleId, (counts.get(ruleId) ?? 0) + by);
  };
  for (const finding of result.findings) {
    if (finding.kind !== "problem") continue;
    bump(findings, finding.ruleId, 1);
    if (finding.fixes.length > 0) bump(fixable, finding.ruleId, 1);
  }
  for (const entry of result.hidden) bump(findings, entry.ruleId, entry.count);

  const candidates: Candidate[] = config.plugins.flatMap((plugin, packIndex) =>
    Object.entries(plugin.rules).flatMap(([key, rule]) => {
      if (!ruleIsOn(config, plugin.name, key, rule.meta)) return [];
      const ruleId = `${plugin.name}/${key}`;
      return [
        {
          ruleId,
          group: `${plugin.name}/${rule.meta.group}`,
          tier: rule.meta.tier,
          findings: findings.get(ruleId) ?? 0,
          fixable: fixable.get(ruleId) ?? 0,
          protects: rule.meta.description,
          packIndex,
        },
      ];
    }),
  );
  candidates.sort(compareCandidates);
  return {
    rules: candidates.map((candidate, index) => ({
      order: index + 1,
      ruleId: candidate.ruleId,
      group: candidate.group,
      tier: candidate.tier,
      findings: candidate.findings,
      fixable: candidate.fixable,
      protects: candidate.protects,
      ...(silent.has(candidate.ruleId) ? { silent: silent.get(candidate.ruleId) ?? "" } : {}),
    })),
  };
}

/** What `stateward next` does now. */
export type Advance =
  /**
   * `row`: the next rule that has findings (undefined when only clean rules are left); `clean`:
   * every rule not on yet that has nothing to fix, turned on with it, since they cannot overwhelm.
   */
  | { kind: "turn-on"; row: PlanRow | undefined; clean: readonly PlanRow[] }
  /** The rule turned on last still has findings. */
  | { kind: "blocked"; row: PlanRow }
  | { kind: "all-on" };

/** The next step from the rules turned on so far (in the order they were turned on). */
export function advance(plan: Plan, enabled: readonly string[], anyway: boolean): Advance {
  const off = plan.rules.filter((row) => !enabled.includes(row.ruleId));
  if (off.length === 0) return { kind: "all-on" };
  const lastId = enabled.at(-1);
  const last = plan.rules.find((row) => row.ruleId === lastId);
  if (!anyway && last !== undefined && last.findings > 0) return { kind: "blocked", row: last };
  return {
    kind: "turn-on",
    row: off.find((row) => row.findings > 0),
    clean: off.filter((row) => row.findings === 0),
  };
}

function countOf(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The lines `stateward next` and the editor's "Turn on the next rule" tell the developer after a
 * `turn-on` step: the clean rules that came along, the rule now on with what it protects, and
 * what to do next. One writer, so the CLI and the editor never say different things.
 */
export function describeTurnOn(step: Extract<Advance, { kind: "turn-on" }>): readonly string[] {
  const lines: string[] = [];
  if (step.clean.length > 0) {
    lines.push(`also on, nothing to fix: ${step.clean.map((row) => row.ruleId).join(", ")}`);
  }
  if (step.row === undefined) {
    lines.push("every rule is on now");
  } else {
    lines.push(
      `on: ${step.row.ruleId} (${countOf(step.row.findings, "finding")}, ${String(step.row.fixable)} fixable)`,
      step.row.protects,
      "run stateward check to see them",
    );
  }
  return lines;
}
