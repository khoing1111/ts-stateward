import { useReducer } from "react";

/** @final "paid" */
export type Payment = { status: "paying" } | { status: "failed" } | { status: "paid" };
type PaymentEvent = { type: "ok" } | { type: "no" } | { type: "retry" };

function payment(state: Payment, event: PaymentEvent): Payment {
  const status = state.status;
  if (status === "paid" && event.type === "retry") return { status: "paying" };
  if (status === "failed") return event.type === "retry" ? { status: "paying" } : state;
  if (status !== "paying") return state;
  return event.type === "ok" ? { status: "paid" } : { status: "failed" };
}

export const usePayment = () => useReducer(payment, { status: "paying" });
