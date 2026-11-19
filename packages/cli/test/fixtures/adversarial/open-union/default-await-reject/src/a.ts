import type { OrderStatus } from "./orders.js";

export async function label(status: OrderStatus): Promise<string> {
  switch (status) {
    case "pending":
      return "P";
    case "paid":
      return "$";
    case "shipped":
      return "S";
    default:
      await Promise.reject(new Error(status));
      return "";
  }
}
