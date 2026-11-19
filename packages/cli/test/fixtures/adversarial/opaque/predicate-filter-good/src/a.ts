import { orderId, type OrderId } from "./order-id.js";

export function ids(raw: string[]): OrderId[] {
  return raw.map(orderId).filter((x): x is OrderId => x !== undefined);
}
