import { orderId, type OrderId } from "./order-id.js";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return (await response.json()) as T;
}

export async function load(): Promise<OrderId | undefined> {
  const order = await getJson<{ id: string }>("/order");
  return orderId(order.id);
}
