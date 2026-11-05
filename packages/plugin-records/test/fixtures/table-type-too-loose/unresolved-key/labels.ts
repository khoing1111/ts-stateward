import type { Status } from "@missing/status-types";

const labels: Record<string, string> = { idle: "Idle", done: "Done" };

export function label(status: Status): string {
  return labels[status];
}
