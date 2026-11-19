import { orderId, type OrderId } from "./order-id.js";

type Order = { id: OrderId };

export function real(): OrderId | undefined {
  const id = orderId("o-1");
  if (id === undefined) return undefined;
  const order: Order = { id };
  return order.id;
}
