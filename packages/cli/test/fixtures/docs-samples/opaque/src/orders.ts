import type { OrderId } from "./order-id";

export function newOrder(): OrderId {
  const id: OrderId = "o-2";
  return id;
}
