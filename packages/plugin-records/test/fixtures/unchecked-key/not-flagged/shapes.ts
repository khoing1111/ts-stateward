type Status = "draft" | "sent";

const LABELS = { draft: "Draft", sent: "Sent" } as const;
const COUNTS: Record<Status, number> = { draft: 0, sent: 0 };

declare function isDefined<T>(value: T | undefined): value is T;

// Keys taken from the same object.

export function forEachKey(): void {
  Object.keys(LABELS).forEach((key) => console.log(LABELS[key as keyof typeof LABELS]));
}

export function mapKeys(): string[] {
  return Object.keys(LABELS).map((key) => LABELS[key as Status]);
}

export function filterKeys(): string[] {
  return Object.keys(COUNTS).filter((key) => COUNTS[key as Status] > 0);
}

export function reduceKeys(): number {
  return Object.keys(COUNTS).reduce((sum, key) => sum + COUNTS[key as Status], 0);
}

export function forIn(): string[] {
  const found: string[] = [];
  for (const key in LABELS) found.push(LABELS[key as Status]);
  return found;
}

export function forOfKeys(): string[] {
  const found: string[] = [];
  for (const key of Object.keys(LABELS)) found.push(LABELS[key as Status]);
  return found;
}

export function forOfEntries(): number {
  let total = 0;
  for (const [key, count] of Object.entries(COUNTS)) total += count + COUNTS[key as Status];
  return total;
}

export function entriesCallback(): string[] {
  return Object.entries(LABELS).map(([key]) => LABELS[key as Status]);
}

export class Board {
  private readonly labels = { draft: "Draft", sent: "Sent" };

  names(): string[] {
    return Object.keys(this.labels).map((key) => this.labels[key as Status]);
  }
}

// A read that handles a missing key.

export function nullish(status: string): string {
  return LABELS[status as Status] ?? status;
}

export function or(status: string): string {
  return LABELS[status as Status] || status;
}

export function optionalChain(status: string): number | undefined {
  return LABELS[status as Status]?.length;
}

export function comparedWithUndefined(status: string): string {
  const label = LABELS[status as Status];
  if (label === undefined) return status;
  return label;
}

export function comparedWithNull(status: string): string {
  const label = LABELS[status as Status];
  return label != null ? label : status;
}

export function guarded(status: string): string {
  const label = LABELS[status as Status];
  return isDefined(label) ? label : status;
}

// A key checked against a collection of valid keys.

const VALID = new Set(["draft", "sent"]);
const KEYS = ["draft", "sent"] as const;
const LIST: string[] = ["draft", "sent"];

export function setHas(status: string): string | undefined {
  if (VALID.has(status)) return LABELS[status as Status];
  return undefined;
}

export function arrayIncludes(status: string): string | false {
  return LIST.includes(status) && LABELS[status as Status];
}

export function tupleTernary(status: Status | "other"): string | undefined {
  return (KEYS as readonly string[]).includes(status) ? LABELS[status as Status] : undefined;
}

export function earlyExit(status: string): string {
  if (!VALID.has(status)) return status;
  return LABELS[status as Status];
}

export function loopContinue(statuses: string[]): string[] {
  const found: string[] = [];
  for (const status of statuses) {
    if (!LIST.includes(status)) continue;
    found.push(LABELS[status as Status]);
  }
  return found;
}
