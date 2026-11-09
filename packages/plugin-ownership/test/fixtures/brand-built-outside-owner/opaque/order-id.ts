import type { Opaque } from "./guarantees.js";

export type OrderId = Opaque<string, "OrderId">;

export function orderId(raw: string): OrderId | undefined {
  return raw.startsWith("o-") ? raw : undefined;
}

// The owner may build its own values.
export const FIRST: OrderId = "o-1";
