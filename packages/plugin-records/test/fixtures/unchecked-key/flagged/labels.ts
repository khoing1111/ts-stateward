type Status = "draft" | "sent";

const LABELS = { draft: "Draft", sent: "Sent" } as const;

export function castKeyof(status: string): string {
  return LABELS[status as keyof typeof LABELS];
}

export function castUnion(status: string): string {
  const label = LABELS[status as Status];
  return label;
}

export function inGuard(status: string): string | undefined {
  if (status in LABELS) return LABELS[status as Status];
  return undefined;
}

export function stored(status: string): string {
  const key = status as Status;
  return LABELS[key];
}

export function shouted(status: string): string {
  return LABELS[status as Status].toUpperCase();
}

const COUNTS: Record<Status, number> = { draft: 1, sent: 2 };

export function count(value: unknown): number {
  return COUNTS[value as Status];
}

export function isStatus(key: string): key is Status {
  return key in LABELS;
}

export const isLabelKey = (key: string): key is keyof typeof LABELS => key in LABELS;

export const STATUSES = Object.freeze(Object.keys(LABELS));
