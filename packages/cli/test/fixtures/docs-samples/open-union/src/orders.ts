import type { OpenUnion } from "./guarantees";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;
type Order = { status: OrderStatus };

export function label(order: Order): string {
  switch (order.status) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "shipped":
      return "Shipped";
  }
}
