import type { OrderStatus } from "./orders.js";

function fail(message: string): void {
  throw new Error(message);
}

export function label(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "P";
    case "paid":
      return "$";
    case "shipped":
      return "S";
    default:
      fail(status);
      return "";
  }
}
