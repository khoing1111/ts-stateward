import type { OrderStatus } from "./orders.js";

export function label(s: OrderStatus): string {
  const k: "pending" | "paid" | "shipped" = s;
  switch (k) {
    case "pending":
      return "P";
    case "paid":
      return "D";
    case "shipped":
      return "S";
  }
}
