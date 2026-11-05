import type { Plan, PlanRow } from "@stateward/core/internal";
import { ROLLOUT_FILE, advance } from "@stateward/core/internal";
import { plural } from "./format.js";

/** Where the project stands in the rollout: what is on, and the one thing to do now. */
export type PlanReport = {
  rollout: boolean;
  /** The rules turned on, in order; empty when `rollout` is off (every rule runs then). */
  enabled: readonly string[];
  rules: readonly PlanRow[];
  /** The next step, in words. */
  next: string;
};

const CLEAN = "nothing to fix, turns on clean";

function nextStep(plan: Plan, rollout: boolean, enabled: readonly string[]): string {
  if (!rollout) {
    return "rollout is off, so every rule runs; to go one rule at a time, set `rollout: true` in your stateward config, then run `stateward next`";
  }
  const step = advance(plan, enabled, false);
  switch (step.kind) {
    case "turn-on":
      return step.row === undefined
        ? "run `stateward next` to turn on the rules left; none of them has anything to fix"
        : `run \`stateward next\` to turn on rule ${String(step.row.order)} (${step.row.ruleId})`;
    case "blocked":
      return `fix the ${plural(step.row.findings, "finding")} of \`${step.row.ruleId}\`, then run \`stateward next\``;
    case "all-on":
      return `every rule is on; you can remove ${ROLLOUT_FILE} and \`rollout\` from your config`;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

export function buildPlanReport(
  plan: Plan,
  rollout: boolean,
  enabled: readonly string[],
): PlanReport {
  return { rollout, enabled, rules: plan.rules, next: nextStep(plan, rollout, enabled) };
}

export function formatPlanJson(report: PlanReport): string {
  return JSON.stringify(report, null, 2);
}

function onLine(report: PlanReport): string {
  if (!report.rollout) return "on: every rule (rollout is off)";
  return `on: ${report.enabled.length === 0 ? "none yet" : report.enabled.join(", ")}`;
}

type GroupedRows = { group: string; rows: readonly PlanRow[] };

/**
 * The plan's rows under their groups: groups in the order of their first rule, and the rows of a
 * group in plan order. `order` stays the plan's own number, so "rule 3" means the same everywhere.
 */
function byGroup(rows: readonly PlanRow[]): readonly GroupedRows[] {
  const groups = new Map<string, PlanRow[]>();
  for (const row of rows) {
    const members = groups.get(row.group);
    if (members === undefined) groups.set(row.group, [row]);
    else members.push(row);
  }
  return [...groups].map(([group, members]) => ({ group, rows: members }));
}

export function formatPlanPretty(report: PlanReport): string {
  const header = ["order", "rule", "findings", "fixable", "protects"];
  const cells = (row: PlanRow): string[] => [
    String(row.order),
    row.ruleId,
    String(row.findings),
    String(row.fixable),
    row.findings === 0 ? `${row.protects} (${CLEAN})` : row.protects,
  ];
  const groups = byGroup(report.rules);
  const widths = header.map((title, column) =>
    Math.max(
      title.length,
      ...groups.flatMap((entry) => entry.rows.map((row) => cells(row)[column]?.length ?? 0)),
    ),
  );
  // Findings and fixable are numbers, so right-aligned; the last column is free text.
  const line = (row: readonly string[]): string =>
    row
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        if (column === row.length - 1) return cell;
        return column === 2 || column === 3 ? cell.padStart(width) : cell.padEnd(width);
      })
      .join("  ");
  const body = groups.flatMap((entry) => [
    "",
    entry.group,
    ...entry.rows.flatMap((row) => [
      line(cells(row)),
      ...(row.silent === undefined ? [] : [`    silent: ${row.silent}`]),
    ]),
  ]);
  return [line(header), ...body, "", onLine(report), `next: ${report.next}.`, ""].join("\n");
}
