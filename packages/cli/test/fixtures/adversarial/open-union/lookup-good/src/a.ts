import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): number {
  switch (status) {
    case "pending":
      return 1;
    case "paid":
      return 2;
    case "shipped":
      return 3;
    default:
      return 0;
  }
}
