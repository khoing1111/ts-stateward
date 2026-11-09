import type { Order, OrderStatus } from "./types/index.js";

// Imported through an index file; a `default` that handles a known case nobody allowed.
export function color(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "grey";
    default:
      return "green";
  }
}

// Destructured from the order: every status listed, no `default`.
export function label({ status }: Order): string {
  switch (status) {
    case "pending":
      return "Waiting for payment";
    case "paid":
      return "Paid";
    case "shipped":
      return "On its way";
  }
  return "";
}

// A `const` with no type of its own: every status listed, no `default`.
export function short(order: Order): string {
  const current = order.status;
  switch (current) {
    case "pending":
      return "…";
    case "paid":
      return "$";
    case "shipped":
      return ">";
  }
  return "";
}

// Correct: a `default` for a value the union does not list.
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
