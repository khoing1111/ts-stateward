import { orderId, type OrderId } from "./order-id.js";

export function next(n: number): OrderId | undefined {
  return orderId(`o-${n}`);
}
