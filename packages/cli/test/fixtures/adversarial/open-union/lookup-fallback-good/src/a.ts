import type { OrderStatus } from "./orders.js";

const labels: Partial<Record<string, string>> = { pending: "P", paid: "$", shipped: "S" };

export function label(status: OrderStatus): string {
  return labels[status] ?? status;
}
