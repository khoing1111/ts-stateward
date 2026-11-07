type Status = "idle" | "failed";

declare const status: Status;
declare const other: Status;
const labels: Record<string, string> = { idle: "Idle" };
const others: Record<string, string> = { idle: "Idle" };

export function otherKey(): string {
  if (other in labels) return labels[status];
  return "";
}

export function otherMap(): string {
  if (status in others) return labels[status];
  return "";
}

export function elseBranch(): string {
  if (status in labels) return "";
  return labels[status];
}

export function orInsteadOfAnd(): boolean {
  return status in labels || labels[status].length > 0;
}

export const afterwards = [status in labels, labels[status]];

export function negated(): string {
  if (!(status in labels)) return labels[status];
  return "";
}

/** The entry made is another one, or it is made after the read. */
export function otherEntry(other: string): number {
  labels[other] = labels[other] ?? "";
  return labels[status].length;
}

export function madeAfter(): number {
  const length = labels[status].length;
  labels[status] ??= "";
  return length;
}
