const LABELS = { draft: "Draft", sent: "Sent" } as const;

export function label(status: string): string | undefined {
  return LABELS[status as keyof typeof LABELS];
}
