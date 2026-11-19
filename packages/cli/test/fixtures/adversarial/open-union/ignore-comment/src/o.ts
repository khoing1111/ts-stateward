import type { OpenUnion } from "./guarantees.js";

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

export function label(status: OrderStatus): string {
  // stateward-ignore unions/non-exhaustive-switch: the caller checks the status first
  switch (status) {
    case "pending":
      return "P";
    case "paid":
      return "$";
    case "shipped":
      return "S";
  }
  return "?";
}
