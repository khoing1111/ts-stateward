import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): Promise<string> {
  switch (status) {
    case "pending":
      return Promise.resolve("P");
    case "paid":
    case "shipped":
      return Promise.resolve("D");
    default:
      return new Promise((resolve) => {
        resolve("?");
      });
  }
}
