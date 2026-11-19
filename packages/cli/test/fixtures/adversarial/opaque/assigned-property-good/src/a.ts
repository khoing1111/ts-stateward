import { orderId, type OrderId } from "./order-id.js";

const holder: { id: OrderId | undefined } = { id: undefined };

export function remember(raw: string): void {
  holder.id = orderId(raw);
}
