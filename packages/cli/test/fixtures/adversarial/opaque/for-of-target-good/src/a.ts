import { orderId, type OrderId } from "./order-id.js";

type Order = { id: OrderId };

export function fill(order: Order, raws: readonly string[]): void {
  for (const raw of raws) {
    const id = orderId(raw);
    if (id !== undefined) order.id = id;
  }
}
