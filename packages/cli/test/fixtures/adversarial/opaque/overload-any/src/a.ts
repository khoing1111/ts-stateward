import type { OrderId } from "./order-id.js";

export function parse(raw: string): OrderId;
export function parse(raw: any) {
  return raw;
}
