import type { OrderStatus } from "./orders.js";

export function label(status: OrderStatus): string {
  switch (status as string) {
    case "paid":
      return "$";
  }
  return "?";
}
