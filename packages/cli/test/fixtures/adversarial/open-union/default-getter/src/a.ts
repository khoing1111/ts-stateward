import type { OrderStatus } from "./orders.js";

export class L {
  get bad(): string {
    throw new Error("x");
  }

  label(s: OrderStatus): string {
    switch (s) {
      case "pending":
        return "P";
      case "paid":
        return "D";
      case "shipped":
        return "S";
      default:
        return this.bad;
    }
  }
}
