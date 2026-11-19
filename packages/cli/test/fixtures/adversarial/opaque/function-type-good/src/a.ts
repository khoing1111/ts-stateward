import { orderId, type OrderId } from "./order-id.js";

export const real: (raw: string) => OrderId | undefined = orderId;

export function wrap(make: (raw: string) => string): (raw: string) => OrderId | undefined {
  return (raw) => orderId(make(raw));
}
