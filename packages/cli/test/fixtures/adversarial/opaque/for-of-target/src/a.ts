import type { OrderId } from "./order-id.js";

type Order = { id: OrderId };

export function fill(order: Order): void {
  for (order.id of ["o-1"]) console.log(order.id);
}
