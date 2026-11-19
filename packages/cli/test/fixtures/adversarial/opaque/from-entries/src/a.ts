import type { OrderId } from "./order-id.js";

export const byName: Record<string, OrderId> = Object.fromEntries([["first", "bad"]]);
