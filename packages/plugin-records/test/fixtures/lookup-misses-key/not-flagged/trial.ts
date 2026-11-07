// A read whose missing entry the code around it handles (umami, user trial 1.0.2).
type Section = "overview" | "events" | "sessions";
type Operator = "eq" | "neq";

const shown: Record<string, boolean> = {};
const options: Record<string, string[]> = {};
const fallback: string[] = [];

/** The same read tested for truthiness first: the `then` only runs when the entry is there. */
export function first(value: unknown): object | undefined {
  const record = value as Record<string, unknown>;
  if (record["0"] && typeof record["0"] === "object") {
    return record["0"];
  }
  return undefined;
}

export function typed(section: Section): boolean {
  if (typeof shown[section] === "boolean") return shown[section];
  return false;
}

/** The read is the right of `&&`, and the whole has a fallback with `??`. */
export function optionsFor(operator: Operator | undefined): string[] {
  return (operator && options[operator]) ?? fallback;
}

/** Compared with a literal: a missing entry is simply not equal. */
export function isShown(section: Section): boolean {
  return shown[section] === true;
}

export function isHidden(section: Section): boolean {
  return false !== shown[section];
}

/** The entry is made on the line before when it is missing (`m[k] = m[k] ?? {}`, `m[k] ??= {}`). */
const seen: Record<string, Record<string, boolean>> = {};

export function mark(section: Section, name: string): void {
  seen[section] = seen[section] ?? {};
  seen[section][name] = true;
}

export function markAgain(section: Section, name: string): Record<string, boolean> {
  seen[section] ??= {};
  seen[section][name] = true;
  return seen[section];
}

export function markOr(section: Section, name: string): void {
  seen[section] = seen[section] || {};
  seen[section][name] = true;
}
