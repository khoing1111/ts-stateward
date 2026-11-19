import { orderId, type OrderId } from "./order-id.js";

const first = orderId("o-1");

export const byName: Record<string, OrderId> = first === undefined ? {} : { first };
