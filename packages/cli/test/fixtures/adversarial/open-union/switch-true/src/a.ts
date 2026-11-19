import type { Order } from "./orders.js";

export function label({ status }: Order): number {
  switch (true) {
    case status === "pending":
      return 1;
    case status === "paid":
      return 2;
    case status === "shipped":
      return 3;
  }
  throw new Error("unknown status");
}
