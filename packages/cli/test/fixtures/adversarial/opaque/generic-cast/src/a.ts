import type { OrderId } from "./order-id.js";

function make<T>(raw: string): T {
  return raw as unknown as T;
}

export function fake(): OrderId {
  return make<OrderId>("o-1");
}
