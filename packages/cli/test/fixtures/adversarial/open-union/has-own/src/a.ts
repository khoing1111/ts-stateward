import type { OrderStatus } from "./orders.js";

const labels = { paid: "$", pending: "P", shipped: "S" };

export function known(status: OrderStatus): boolean {
  return Object.hasOwn(labels, status);
}
