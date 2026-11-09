import type { OpenUnion } from "./guarantees.js";

/** The server adds statuses before this app knows them. */
export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;

export type Order = { id: string; status: OrderStatus };

// Every status listed, no `default`: a status the server adds goes nowhere.
export function label(order: Order): string {
  switch (order.status) {
    case "pending":
      return "Waiting for payment";
    case "paid":
      return "Paid";
    case "shipped":
      return "On its way";
  }
  return "";
}

// A `default` handles a value the union does not list: correct.
export function icon(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "clock";
    case "paid":
      return "check";
    case "shipped":
      return "truck";
    default:
      return "question";
  }
}

// A `default` that also handles a known case nobody allowed: that case is reported as usual.
export function color(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "grey";
    default:
      return "green";
  }
}

// `satisfies never` in the `default` of an open union reads like a plain `default`.
export function done(status: OrderStatus): boolean {
  switch (status) {
    case "pending":
    case "paid":
      return false;
    case "shipped":
      return true;
    default:
      status satisfies never;
      return false;
  }
}
