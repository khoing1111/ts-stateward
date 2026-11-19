type Status = "idle" | "failed";

export function title(labels: Record<string, string>, status: Status): string {
  return labels[status].toUpperCase();
}
