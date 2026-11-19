import type { OrderId } from "./order-id.js";

export function ids(raw: string[]): OrderId[] {
  return raw.filter((x): x is OrderId => x.startsWith("o-"));
}
