import type { OrderId } from "./order-id.js";

export function show({ id = "bad" }: { id?: OrderId }): string {
  return id;
}
