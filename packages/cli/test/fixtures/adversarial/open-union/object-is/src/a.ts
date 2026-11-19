import type { OrderStatus } from "./orders.js";

export function isPaid(status: OrderStatus): boolean {
  return Object.is(status, "paid");
}
