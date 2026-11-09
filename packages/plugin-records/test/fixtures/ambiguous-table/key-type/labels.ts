import type { Status } from "./status.js";

// Partial on purpose: "archived" falls back to the default.
const labels: Record<string, string> = { draft: "Draft", sent: "Sent" };

export function label(status: Status): string {
  return labels[status] ?? "Other";
}

// Every status has an entry, and the reads use the declared type.
const colors: Record<string, string> = { draft: "grey", sent: "green", archived: "black" };

export function color(status: Status): string {
  return colors[status];
}
