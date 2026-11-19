import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): number {
  return status === "pending"
    ? 1
    : status === "paid"
      ? 2
      : status === "shipped"
        ? 3
        : (() => {
            throw new Error(status);
          })();
}
