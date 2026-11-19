import type { OrderStatus } from "./orders.js";

export async function label(status: OrderStatus): Promise<number> {
  if (status === "pending") return 1;
  else if (status === "paid") return 2;
  else if (status === "shipped") return 3;
  else return Promise.reject(new Error(status));
}
