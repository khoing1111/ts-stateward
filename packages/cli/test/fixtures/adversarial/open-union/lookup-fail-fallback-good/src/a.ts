import type { OrderStatus } from "./orders.js";

const labels: Partial<Record<string, string>> = { pending: "P", paid: "D", shipped: "S" };

export function label(s: OrderStatus): string {
  return labels[s] ?? "?";
}
