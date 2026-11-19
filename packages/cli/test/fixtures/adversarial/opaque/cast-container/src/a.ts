import type { OrderId } from "./order-id.js";

export function many(raw: string[]): OrderId[] {
  return raw as OrderId[];
}
