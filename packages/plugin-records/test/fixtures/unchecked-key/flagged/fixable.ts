type Status = "draft" | "sent";

const LABELS = { draft: "Draft", sent: "Sent" } as const;

export function label(status: string): string | undefined {
  return LABELS[status as Status];
}

export function isStatus(key: string): key is Status {
  return key in LABELS;
}
