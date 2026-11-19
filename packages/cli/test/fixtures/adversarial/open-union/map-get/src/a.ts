import type { OrderStatus } from "./orders.js";

const labels = new Map<string, string>([
  ["pending", "P"],
  ["paid", "$"],
  ["shipped", "S"],
]);

export function label(status: OrderStatus): string {
  return labels.get(status) ?? "";
}
