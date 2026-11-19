import type { OrderId } from "./order-id.js";

export type Order = { id: OrderId; total: number };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return (await response.json()) as T;
}

export async function load(): Promise<OrderId> {
  const order = await getJson<Order>("/order");
  return order.id;
}
