import type { OpenUnion } from "./guarantees.js";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

export function rank(status: OrderStatus): Promise<number> {
  switch (status) {
    case "pending":
      return Promise.resolve(1);
    case "paid":
      return Promise.resolve(2);
    case "shipped":
      return Promise.resolve(3);
    default:
      return Promise.resolve(0);
  }
}
