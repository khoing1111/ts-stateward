import type { OrderId } from "./order-id.js";

export function table(raw: Map<string, string>): Map<string, OrderId> {
  return raw;
}
