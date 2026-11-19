import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): string {
  switch (String(status)) {
    case "paid":
      return "$";
    default:
      throw new Error("unknown");
  }
}
