import type { Action } from "./actions.js";

// An example from a real project: a fixed table typed as an open one. The union in scope has exactly
// its keys, so the fixed-table fix checks it against `Action`.
const ACTION_IMPACTS: Record<string, string> = {
  approve: "The task moves on",
  reject: "The task goes back",
  escalate: "A lead is asked",
};

export function impactOf(action: Action): string {
  return ACTION_IMPACTS[action];
}
