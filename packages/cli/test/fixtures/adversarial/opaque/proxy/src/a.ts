import type { OrderId } from "./order-id.js";

type Order = { id: OrderId };

export function fake(): OrderId {
  const order = new Proxy({ id: "o-1" }, {}) as Order;
  return order.id;
}
