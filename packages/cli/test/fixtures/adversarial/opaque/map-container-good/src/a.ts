import { orderId, type OrderId } from "./order-id.js";

export function table(raw: Map<string, string>): Map<string, OrderId | undefined> {
  return new Map([...raw].map(([key, value]) => [key, orderId(value)]));
}
