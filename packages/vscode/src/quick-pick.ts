import type { PlanRule } from "./protocol.js";

export type Choice = { label: string; description?: string; detail?: string };

export type PlanItem = Choice & { ruleId: string };

function countOf(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The part of a "<plugin>/<name>" id after the plugin: the group's or the rule's own name. */
function nameOf(id: string): string {
  return id.slice(id.indexOf("/") + 1);
}

/**
 * One quick-pick item per rule of the plan, in the plan's order; choosing one explains the rule.
 * The label reads `group · rule`.
 */
export function planItems(rules: readonly PlanRule[]): readonly PlanItem[] {
  return rules.map((rule) => ({
    ruleId: rule.ruleId,
    label: `${String(rule.order)}. ${nameOf(rule.group)} · ${nameOf(rule.ruleId)}`,
    description: `${countOf(rule.findings, "finding")}, ${String(rule.fixable)} fixable`,
    detail: rule.protects,
  }));
}

/** The rule ids to explain, in the plan's order. */
export function ruleItems(rules: readonly PlanRule[]): readonly PlanItem[] {
  return rules.map((rule) => ({ ruleId: rule.ruleId, label: rule.ruleId, detail: rule.protects }));
}

export type ActionId = "plan" | "next" | "explain" | "recheck" | "setup";

export type ActionItem = Choice & { action: ActionId; command: string };

/** The palette commands, by action. */
export const COMMANDS: Readonly<Record<ActionId, string>> = {
  plan: "stateward.showPlan",
  next: "stateward.turnOnNextRule",
  explain: "stateward.explainRule",
  recheck: "stateward.recheck",
  setup: "stateward.setUp",
};

/** What clicking the status bar item offers; "Set up" is only for projects without a config. */
export function actionItems(): readonly ActionItem[] {
  const item = (action: ActionId, label: string, detail: string): ActionItem => ({
    action,
    command: COMMANDS[action],
    label,
    detail,
  });
  return [
    item(
      "plan",
      "Show the rule plan",
      "Every rule with its findings in your code, in a suggested order",
    ),
    item("next", "Turn on the next rule", "Adds the findings of that rule only"),
    item("explain", "Explain a rule…", "Why a rule matters, what it finds, and how to turn it off"),
    item("recheck", "Check again", "Check the whole project again"),
  ];
}
