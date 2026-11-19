import type { OrderStatus } from "./orders.js";

export async function label(status: OrderStatus): Promise<number> {
  if (status === "pending") return 1;
  else if (status === "paid") return 2;
  else return Promise.reject(new Error(status));
}
