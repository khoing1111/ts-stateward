import { orderId, type OrderId } from "./order-id.js";

export async function load(raw: string): Promise<OrderId | undefined> {
  return orderId(raw);
}
