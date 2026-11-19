import type { OrderId } from "./order-id.js";

function show(id: OrderId): string {
  return id;
}

export const a = show.call(null, "o-1");
export const b = Reflect.apply(show, null, ["o-2"]);
