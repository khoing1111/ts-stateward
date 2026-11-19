import type { OrderId } from "./order-id.js";

const holder: { id?: OrderId } = {};

export function remember(): void {
  holder.id ??= "bad";
}
