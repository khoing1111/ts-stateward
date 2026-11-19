import { orderId, type OrderId } from "./order-id.js";

type Order = { id: OrderId };

export function set(order: Order): void {
  const id = orderId("o-1");
  if (id !== undefined) order.id = id;
}
