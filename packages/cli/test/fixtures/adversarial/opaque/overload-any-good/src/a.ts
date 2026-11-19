import { orderId, type OrderId } from "./order-id.js";

export function parse(raw: string): OrderId | undefined;
export function parse(raw: string): OrderId | undefined {
  return orderId(raw);
}
