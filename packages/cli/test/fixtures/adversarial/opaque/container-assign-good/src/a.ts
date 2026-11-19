import { orderId, type OrderId } from "./order-id.js";

export function keep(raw: string[]): number {
  const ids: (OrderId | undefined)[] = raw.map(orderId);
  return ids.length;
}
