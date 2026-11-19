import type { OrderStatus } from "./orders.js";

type Known = "pending" | "paid" | "shipped";

function text(k: Known): string {
  switch (k) {
    case "pending":
      return "P";
    case "paid":
      return "D";
    case "shipped":
      return "S";
  }
}

export function label(s: OrderStatus): string {
  return text(s);
}
