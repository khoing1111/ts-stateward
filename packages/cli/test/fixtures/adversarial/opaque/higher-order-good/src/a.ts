import { orderId } from "./order-id.js";

export function many(raw: string[]) {
  return raw.map(orderId);
}
