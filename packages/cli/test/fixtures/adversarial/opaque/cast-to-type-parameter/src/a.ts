import type { OrderId } from "./order-id.js";

export function fake<T extends OrderId>(): T {
  return "o-1" as T;
}
