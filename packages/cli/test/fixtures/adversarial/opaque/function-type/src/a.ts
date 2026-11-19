import type { OrderId } from "./order-id.js";

export const fake: (raw: string) => OrderId = (raw: string): string => raw;

export function wrap(make: (raw: string) => string): (raw: string) => OrderId {
  return make;
}
