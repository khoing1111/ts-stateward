import type { OpenUnion } from "./guarantees.js";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function known(value: string): boolean {
  return value.length > 0;
}

export function rank(status: OrderStatus): number | undefined {
  switch (status) {
    case "pending":
      return 1;
    case "paid":
      return 2;
    case "shipped":
      return 3;
    default:
      invariant(known(status), `unknown status ${status}`);
  }
}
