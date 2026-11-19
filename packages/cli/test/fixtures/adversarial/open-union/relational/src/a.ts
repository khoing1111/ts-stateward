import type { OrderStatus } from "./orders.js";

export function label(s: OrderStatus): string {
  if (s < "q") return "early";
  return "late";
}
