import type { OrderStatus } from "./orders.js";

function fail(v: unknown): never {
  throw new Error(String(v));
}

const labels: Partial<Record<string, string>> = { pending: "P", paid: "D", shipped: "S" };

export function label(s: OrderStatus): string {
  return labels[s] ?? fail(s);
}
