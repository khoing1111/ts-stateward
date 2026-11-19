import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "P";
    case "paid":
      return "$";
    case "shipped":
      return "S";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
