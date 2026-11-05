export type OrderState =
  | { status: "open" }
  | { status: "paid" }
  | { status: "cancelled" }
  | { status: "failed" };

export type OrderEvent = { type: "pay" } | { type: "cancel" } | { type: "fail" };

// TypeScript checks these names against the union: a misspelt state does not compile.
export const ORDER_FINAL_STATES = ["paid", "cancelled"] as const satisfies readonly OrderState["status"][];

const INITIAL_STATE: OrderState = { status: "open" };

// No useReducer and no @initial: the default of `state` says where it starts.
export function orderReducer(state: OrderState = INITIAL_STATE, event: OrderEvent): OrderState {
  switch (state.status) {
    case "open":
      if (event.type === "pay") return { status: "paid" };
      if (event.type === "cancel") return { status: "cancelled" };
      return { status: "failed" };
    case "paid":
    case "cancelled":
    case "failed":
      return state;
  }
}
