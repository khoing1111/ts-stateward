import { isKeyOf } from "./keys.js";

type Status = "draft" | "sent";

const LABELS = { draft: "Draft", sent: "Sent" } as const;

export function hasOwn(status: string): string | undefined {
  return Object.hasOwn(LABELS, status) ? LABELS[status as Status] : undefined;
}

export function hasOwnPropertyCall(status: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(LABELS, status)) {
    return LABELS[status as keyof typeof LABELS];
  }
  return undefined;
}

export function earlyReturn(status: string): string {
  if (!Object.hasOwn(LABELS, status)) return "Unknown";
  return LABELS[status as Status];
}

export function helper(status: string): string | undefined {
  return isKeyOf(LABELS, status) ? LABELS[status] : undefined;
}

export function helperBeforeCast(status: string): string | false {
  return isKeyOf(LABELS, status) && LABELS[status as Status];
}

function isStatus(key: string): key is Status {
  return typeof key === "string" && Object.hasOwn(LABELS, key);
}

export function custom(status: string): string | undefined {
  if (isStatus(status)) return LABELS[status as Status];
  return undefined;
}

export function typed(status: Status): string {
  return LABELS[status as Status];
}

export function literal(): string {
  return LABELS["draft" as const];
}

const NAMES = new Map([["draft", "Draft"]]);

export function map(status: string): unknown {
  return NAMES[status as keyof typeof NAMES];
}

enum Color {
  Red = "red",
}

export function color(name: string): Color {
  return Color[name as keyof typeof Color];
}

const OPEN: Record<string, string> = { draft: "Draft" };

export function open(status: string): string | undefined {
  return OPEN[status as keyof typeof OPEN];
}

const COUNTS: Record<Status, number> = { draft: 0, sent: 0 };

export function write(status: string): void {
  COUNTS[status as Status] = 1;
}

type Result = { data: string } | { error: string };

export function isFailure(result: Result): result is { error: string } {
  return "error" in result;
}
