import type { OrderStatus } from "./orders.js";

const seen: string[] = [];

function log(message: string): void {
  seen.push(message);
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
      log(status);
      return "?";
  }
}
