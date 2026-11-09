type Status = "draft" | "sent";

const LABELS = { draft: "Draft", sent: "Sent" } as const;
const OTHER = { draft: 1, sent: 2, archived: 3 };
const VALID = new Set(["draft", "sent"]);

export function keysOfAnother(): string[] {
  return Object.keys(OTHER).map((key) => LABELS[key as Status]);
}

export function forInAnother(): string[] {
  const found: string[] = [];
  for (const key in OTHER) found.push(LABELS[key as Status]);
  return found;
}

export function nullishElsewhere(status: string, fallback?: string): string {
  return LABELS[status as Status] + (fallback ?? "");
}

export function usedBeforeTest(status: string): string {
  const label = LABELS[status as Status];
  console.log(label.length);
  if (label === undefined) return status;
  return label;
}

export function includesOther(status: string, other: string): string | undefined {
  if (VALID.has(other)) return LABELS[status as Status];
  return undefined;
}

export function guardAfter(status: string): string {
  const label = LABELS[status as Status];
  if (!VALID.has(status)) return status;
  return label;
}

export function substring(status: string): string | undefined {
  if ("draft sent".includes(status)) return LABELS[status as Status];
  return undefined;
}

export function fromUrl(params: URLSearchParams): string {
  return LABELS[params.get("status") as Status] ?? "none";
}

export function fromStorage(): string {
  const status = localStorage.getItem("status");
  return LABELS[status as Status] ?? "none";
}
