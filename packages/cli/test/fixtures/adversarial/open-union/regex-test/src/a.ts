import type { OrderStatus } from "./orders.js";

export function done(status: OrderStatus): boolean {
  return /^(paid|shipped)$/.test(status);
}
