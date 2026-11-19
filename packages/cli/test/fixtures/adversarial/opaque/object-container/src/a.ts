import type { OrderId } from "./order-id.js";

export function wrap(entry: { id: string }): { id: OrderId } {
  return entry;
}
