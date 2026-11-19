import { useReducer } from "react";

export type OrderState =
  | { status: "cart" }
  | { status: "paying" }
  | { status: "paid" }
  | { status: "refunded" };
export type OrderEvent = { type: "pay" } | { type: "confirm" } | { type: "refund" };

export function order(state: OrderState, event: OrderEvent): OrderState {
  switch (event.type) {
    case "pay":
      return state.status === "cart" ? { status: "paying" } : state;
    case "confirm":
      return state.status === "paying" ? { status: "paid" } : state;
    case "refund":
      return state;
  }
}

export function useOrder() {
  return useReducer(order, { status: "cart" });
}
