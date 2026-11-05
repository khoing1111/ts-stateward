export type Status = "idle" | "uploading" | "failed";

export function statusLabel(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "uploading":
      return "Uploading";
    default:
      return "Unknown";
  }
}

const labels: Record<string, string> = { idle: "Idle", uploading: "Uploading" };

export function statusText(status: Status): string {
  return labels[status];
}
