import { orderId, type OrderId } from "./order-id.js";

export function f(raw: string): OrderId | undefined {
  const id = orderId(raw);
  if (id === undefined) return undefined;
  return orderId(`${id}!x`);
}
