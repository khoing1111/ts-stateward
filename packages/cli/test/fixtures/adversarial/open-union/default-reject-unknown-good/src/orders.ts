import type { OpenUnion } from "./guarantees.js";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

export function rank(status: OrderStatus): unknown {
  switch (status) {
    case "pending":
      return 1;
    case "paid":
      return 2;
    case "shipped":
      return 3;
    default:
      return 0;
  }
}
