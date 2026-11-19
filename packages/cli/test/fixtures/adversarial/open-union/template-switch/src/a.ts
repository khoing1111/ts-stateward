import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): string {
  switch (`${status}`) {
    case "paid":
      return "$";
    default:
      throw new Error("unknown");
  }
}
