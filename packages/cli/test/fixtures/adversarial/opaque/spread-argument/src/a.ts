import type { OrderId } from "./order-id.js";

function show(id: OrderId): string {
  return id;
}

export const a = show(...(["o-1"] as const));
