import { useReducer } from "react";

/** @final "paid" */
export type Payment = { status: "paying" } | { status: "failed" } | { status: "paid" };
type PaymentEvent = { type: "ok" } | { type: "no" } | { type: "retry" };

function payment(state: Payment, event: PaymentEvent): Payment {
  switch (true) {
    case state.status === "paid" && event.type === "retry":
      return { status: "paying" };
    case state.status === "failed" && event.type === "retry":
      return { status: "paying" };
    case state.status === "paying":
      return event.type === "ok" ? { status: "paid" } : { status: "failed" };
    default:
      return state;
  }
}

export const usePayment = () => useReducer(payment, { status: "paying" });
