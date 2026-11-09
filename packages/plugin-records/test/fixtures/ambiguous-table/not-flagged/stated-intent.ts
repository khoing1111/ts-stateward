// Principle 5: each table states its intent in its type, so the rule takes it at its word.
type Action = "create" | "delete";

// Closed and complete.
const ACTION_LABELS = { create: "Create", delete: "Delete" } satisfies Record<Action, string>;
// Closed, partial on purpose.
const ACTION_HELP: Partial<Record<Action, string>> = { create: "Makes a new one" };
// Open dictionary, two spellings.
const EXTENSION_ICONS: Partial<Record<string, string>> = { ts: "code", md: "text" };
const MIME_NAMES: { [key: string]: string | undefined } = { "text/plain": "Text" };

// Closed table read with a key from outside, behind a key guard.
function isAction(key: string): key is Action {
  return key === "create" || key === "delete";
}
export function labelFor(key: string): string {
  if (isAction(key)) return ACTION_LABELS[key];
  if (Object.hasOwn(ACTION_LABELS, key) && key in ACTION_LABELS) return "known";
  return key;
}

export function helpFor(action: Action): string {
  return ACTION_HELP[action] ?? "";
}
export function iconFor(extension: string): string {
  return EXTENSION_ICONS[extension] ?? "file";
}
export function mimeName(type: string): string {
  return MIME_NAMES[type] ?? type;
}
