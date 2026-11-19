import type { OrderStatus } from "./orders.js";

export function label(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "P";
    case "paid":
      return "D";
    case "shipped":
      return "S";
    default:
      return "?";
  }
}
