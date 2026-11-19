import type { OrderStatus } from "./orders.js";

const labels = { paid: "$", pending: "P", shipped: "S" };

export function label(status: OrderStatus): unknown {
  return Reflect.get(labels, status);
}
