import { touchpointStatus } from "./status.js";

const touchpointLabels: Record<string, string> = { open: "Open", closed: "Closed" };

export function currentLabel(): string {
  return touchpointLabels[touchpointStatus()];
}
