// a registry spread into another object is handed on. The copy is read there
// with a key from the server, which stateward does not follow.
const TASK_AGENT_VIEWS: Record<string, string> = { summary: "SummaryView", plan: "PlanView" };
const defaults: Record<string, string> = { color: "red" };

export const registry = { agentViews: { ...TASK_AGENT_VIEWS, extra: "ExtraView" } };
export function viewFor(name: string): string | null {
  return registry.agentViews[name] ?? null;
}
export const copied = Object.assign({}, defaults);
