import type { OrderId } from "./order-id.js";

export function keep(raw: string[]): number {
  const ids: OrderId[] = raw;
  return ids.length;
}
