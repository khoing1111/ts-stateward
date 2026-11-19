import type { OrderStatus } from "./orders.js";

function fail(value: string): string {
  throw new Error(value);
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
      return fail(status);
  }
}
