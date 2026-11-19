import { orderId, type OrderId } from "./order-id.js";

function show(id: OrderId): string {
  return id;
}

const ids = ["o-1"].flatMap((raw) => {
  const id = orderId(raw);
  return id === undefined ? [] : [id];
});
export const a = ids.map((id) => show(id));
