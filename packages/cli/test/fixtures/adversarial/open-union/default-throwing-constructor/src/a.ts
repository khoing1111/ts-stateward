import type { OrderStatus } from "./orders.js";

class Unreachable {
  constructor(v: never) {
    throw new Error(String(v));
  }
}

export function label(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "P";
    case "paid":
      return "D";
    case "shipped":
      return "S";
    default:
      new Unreachable(s);
      return "?";
  }
}
