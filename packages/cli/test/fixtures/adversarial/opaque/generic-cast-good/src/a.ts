import { orderId, type OrderId } from "./order-id.js";

function make<T>(raw: string, check: (raw: string) => T): T {
  return check(raw);
}

export function real(): OrderId | undefined {
  return make("o-1", orderId);
}
