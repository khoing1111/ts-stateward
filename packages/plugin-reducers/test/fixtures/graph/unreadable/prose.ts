import { useReducer } from "react";

/** @final the order is done */
export type OrderState = { stage: "open" } | { stage: "done" };

export function orderReducer(state: OrderState, event: "finish"): OrderState {
  return event === "finish" && state.stage === "open" ? { stage: "done" } : state;
}

export function useOrder() {
  return useReducer(orderReducer, { stage: "open" });
}
