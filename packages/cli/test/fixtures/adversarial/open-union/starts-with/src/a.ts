import type { OrderStatus } from "./orders.js";

export function done(status: OrderStatus): boolean {
  return status.startsWith("p");
}
