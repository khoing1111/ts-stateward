import type { CheckoutEvent, CheckoutState } from "./types.js";

export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case "submitAddress":
      if (state.status !== "cart") return state;
      return { status: "paying", items: state.items, address: event.address };
    case "paymentFailed":
      if (state.status !== "paying") return state;
      return { ...state, status: "paymentFailed", reason: event.reason };
    case "paymentSucceeded":
      if (state.status !== "paying") return state;
      return { status: "paid", orderId: event.orderId };
    case "cancel":
      if (state.status !== "cart") return state;
      return { status: "cancelled" };
  }
}
