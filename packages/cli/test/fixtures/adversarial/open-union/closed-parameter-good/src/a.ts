import type { OrderStatus } from "./orders.js";

function text(k: OrderStatus): string {
  switch (k) {
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

export function label(s: OrderStatus): string {
  return text(s);
}
