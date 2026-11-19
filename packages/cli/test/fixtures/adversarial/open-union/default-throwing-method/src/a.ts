import type { OrderStatus } from "./orders.js";

const errors = {
  fail(value: string): void {
    throw new Error(value);
  },
};

export function label(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "P";
    case "paid":
      return "$";
    case "shipped":
      return "S";
    default:
      errors.fail(status);
      return "";
  }
}
