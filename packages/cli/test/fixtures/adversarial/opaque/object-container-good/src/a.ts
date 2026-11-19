import { orderId, type OrderId } from "./order-id.js";

export function wrap(entry: { id: string }): { id: OrderId | undefined } {
  return { id: orderId(entry.id) };
}
