import type { OrderStatus } from "./orders.js";

function fail(v: unknown): never {
  throw new Error(String(v));
}

function up(t: string): string {
  return t.toUpperCase();
}

export function label(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "P";
    case "paid":
      return "D";
    case "shipped":
      return "S";
    default:
      return up(fail(s));
  }
}
