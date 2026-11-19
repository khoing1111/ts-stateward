import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): Promise<string> {
  switch (status) {
    case "pending":
    case "paid":
    case "shipped":
      return Promise.resolve(status);
    default:
      return (async () => {
        throw new Error(status);
      })();
  }
}
