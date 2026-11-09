import type { OpenUnion } from "../guarantees.js";

/** The server adds statuses before this app knows them. */
export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

export type Order = { id: string; status: OrderStatus };
