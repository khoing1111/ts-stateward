import type { OrderStatus } from "./orders.js";

function unreachable(value: never): never {
  throw new Error(String(value));
}

export function label(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "P";
    case "paid":
      return "$";
    case "shipped":
      return "S";
    default: {
      const result = unreachable(status);
      return result;
    }
  }
}
