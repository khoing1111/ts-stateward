import { touchpointStatus, type TouchpointStatus as Status } from "./status.js";

const touchpointIcons: Record<string, string> = { open: "o", closed: "x" };

export function icon(status: Status = touchpointStatus()): string {
  return touchpointIcons[status];
}
