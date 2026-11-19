import type { OrderId } from "./order-id.js";

export function show({ id }: { id?: OrderId }): string {
  return id ?? "";
}
