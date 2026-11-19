import { orderId, type OrderId } from "./order-id.js";

export function many(raw: string[]): (OrderId | undefined)[] {
  return raw.map(orderId);
}
