import { useReducer } from "react";

/** @final "paid" */
export type Payment =
  | { status: "paying"; n: number }
  | { status: "failed"; n: number }
  | { status: "paid"; n: number };
type PaymentEvent = { type: "ok" } | { type: "retry" };

function payment(state: Payment, event: PaymentEvent): Payment {
  if (state.status === "paid" && event.type === "retry") return { ...state, status: "paying" };
  if (state.status !== "paying") return state;
  return event.type === "ok" ? { ...state, status: "paid" } : { ...state, status: "failed" };
}

export const usePayment = () => useReducer(payment, { status: "paying", n: 0 });
