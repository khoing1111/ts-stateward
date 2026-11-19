import { orderId, type OrderId } from "./order-id.js";

function show(id: OrderId): string {
  return id;
}

const id = orderId("o-1");
export const a = id === undefined ? "" : show(id);
