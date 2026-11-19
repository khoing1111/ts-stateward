import type { OrderId } from "./order-id.js";

type Order = { id: OrderId };

export function set(order: Order): void {
  Object.defineProperty(order, "id", { value: "o-1" });
  Reflect.set(order, "id", "o-2");
}
