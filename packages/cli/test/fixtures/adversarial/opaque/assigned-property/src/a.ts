import type { OrderId } from "./order-id.js";

const holder: { id: OrderId | undefined } = { id: undefined };

export function remember(): void {
  holder.id = "bad";
}
