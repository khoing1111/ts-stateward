import type { OrderId } from "./order-id.js";

export function next(n: number): OrderId {
  const id: OrderId = `o-${n}`;
  return id;
}
