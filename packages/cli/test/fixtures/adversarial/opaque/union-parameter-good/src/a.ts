import { orderId, type OrderId } from "./order-id.js";

export function show(id: OrderId | number): string {
  return String(id);
}

export function first(): string {
  return show(orderId("o-1") ?? 0);
}
