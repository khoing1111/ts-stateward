import { orderId, type OrderId } from "./order-id.js";

export function first<T extends OrderId>(ids: readonly T[]): T | undefined {
  return ids[0];
}

export const one = first([orderId("o-1")].flatMap((id) => (id === undefined ? [] : [id])));
