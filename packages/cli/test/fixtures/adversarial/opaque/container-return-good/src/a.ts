import { orderId, type OrderId } from "./order-id.js";

export function many(raw: string[]): OrderId[] {
  return raw.flatMap((one) => {
    const id = orderId(one);
    return id === undefined ? [] : [id];
  });
}
