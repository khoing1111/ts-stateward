import type { OpenUnion } from "./guarantees.js";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

export function chain(status: OrderStatus): string {
  if (status === "pending") return "P";
  else if (status === "paid") return "$";
  else return "?";
}
