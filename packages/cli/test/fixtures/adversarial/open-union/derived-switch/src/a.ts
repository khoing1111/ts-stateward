import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): string {
  switch (status.toUpperCase()) {
    case "PENDING":
      return "P";
    case "PAID":
      return "$";
  }
  return "?";
}
