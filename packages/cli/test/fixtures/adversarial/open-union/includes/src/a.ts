import type { OrderStatus } from "./orders.js";

const done: string[] = ["paid", "shipped"];

export function isDone(status: OrderStatus): boolean {
  return done.includes(status);
}
