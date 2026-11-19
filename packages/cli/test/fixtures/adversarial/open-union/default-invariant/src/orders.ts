import type { OpenUnion } from "./guarantees.js";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function rank(status: OrderStatus): number {
  switch (status) {
    case "pending":
      return 1;
    case "paid":
      return 2;
    case "shipped":
      return 3;
    default:
      invariant(false, `unknown status ${status}`);
  }
}
