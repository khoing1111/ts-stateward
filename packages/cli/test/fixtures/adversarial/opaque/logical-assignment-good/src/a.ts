import { orderId, type OrderId } from "./order-id.js";

const holder: { id?: OrderId } = {};

export function remember(raw: string): void {
  holder.id ??= orderId(raw);
}
