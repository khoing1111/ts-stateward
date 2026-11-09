import path from "node:path";
import type { Status } from "./protocol.js";

export const STATUS_COMMAND = "stateward.showActions";

export type StatusView = { text: string; tooltip: string };

/** Shown until the first full pass has answered. */
export const WAITING_VIEW: StatusView = {
  text: "Stateward",
  tooltip: "Stateward: waiting for the first check. Click for actions.",
};

/** The config turns no rule on: say so, so a clean status bar is never mistaken for a clean project. */
export const NO_RULES_VIEW: StatusView = {
  text: "Stateward: no rules on",
  tooltip:
    'Stateward: no rules are on. Add `preset: "recommended"`, a group or a rule to stateward.config. Click for actions.',
};

function countOf(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function totals(status: Status): string {
  const counts = `${countOf(status.errors, "error")}, ${countOf(status.warnings, "warning")}, ${countOf(status.infos, "info")}`;
  return status.baselined === 0 ? counts : `${counts}; ${String(status.baselined)} baselined`;
}

function findingsLeft(findings: number): string {
  return findings === 0 ? "nothing left" : `${String(findings)} left`;
}

/** Rollout off: a check mark, or the error count; warnings are in the tooltip. */
function plainView(status: Status): StatusView {
  const { errors } = status;
  return {
    text: errors === 0 ? "$(check) Stateward" : `$(error) Stateward: ${String(errors)}`,
    tooltip: `Stateward: ${totals(status)}. Click for actions.`,
  };
}

/** Rollout on: where the one-rule-at-a-time path stands. */
function rolloutView(status: Status): StatusView {
  const { current, enabled, total } = status.rollout;
  if (current === undefined) {
    return {
      text: `Stateward: ${String(enabled)} of ${String(total)} rules on`,
      tooltip: "Stateward: no rule is on yet. Turn on the next rule to begin.",
    };
  }
  const next =
    current.findings === 0
      ? "Turn on the next rule."
      : "Fix these first, or turn on the next rule anyway.";
  return {
    text: `Stateward: rule ${String(enabled)} of ${String(total)} · ${findingsLeft(current.findings)}`,
    tooltip: `Stateward: ${current.ruleId}, the rule you turned on last, has ${countOf(current.findings, "finding")} left. ${next} All rules that are on: ${totals(status)}.`,
  };
}

/** The status bar item's text and tooltip for the last status; text uses codicons (`$(name)`). */
export function statusView(status: Status | undefined): StatusView {
  if (status === undefined) return WAITING_VIEW;
  if (status.noRulesOn === true) return NO_RULES_VIEW;
  return status.rollout.on ? rolloutView(status) : plainView(status);
}

/** Whether `file` is inside `folder`. */
function isInside(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The status to show for the active file: the one of the nearest config above it (the one the
 * server checks it with), else the last one received.
 */
export function statusFor(
  activeFile: string | undefined,
  statuses: ReadonlyMap<string, Status>,
  last: Status | undefined,
): Status | undefined {
  if (activeFile === undefined) return last;
  const nearest = [...statuses.keys()]
    .filter((configFile) => isInside(activeFile, path.dirname(configFile)))
    .sort((a, b) => path.dirname(b).length - path.dirname(a).length)[0];
  return nearest === undefined ? last : statuses.get(nearest);
}

/**
 * The view of `status`; with several configs running, the tooltip names the config it is for
 * (`label`, as the developer sees it in the explorer).
 */
export function statusViewFor(status: Status | undefined, label: string | undefined): StatusView {
  const view = statusView(status);
  return label === undefined ? view : { text: view.text, tooltip: `${view.tooltip} (${label})` };
}

/**
 * The view while the project check of the shown config runs: the open file's findings are already
 * current (the fast pass), the project-wide ones follow.
 */
export function checkingView(view: StatusView): StatusView {
  return {
    text: "$(sync~spin) Stateward: checking…",
    tooltip: `Stateward is checking the project in the background; the open file's findings are up to date. Last result: ${view.tooltip}`,
  };
}

/** The view when the TypeScript server is not running; `message` says why. */
export function notRunningView(message: string): StatusView {
  return { text: "$(warning) Stateward: not running", tooltip: message };
}

/** `view` with a line added to its tooltip, such as which server is in use; unchanged without one. */
export function withNote(view: StatusView, note: string | undefined): StatusView {
  return note === undefined ? view : { text: view.text, tooltip: `${view.tooltip}\n\n${note}` };
}
