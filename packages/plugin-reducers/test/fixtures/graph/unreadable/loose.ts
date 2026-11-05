import { useReducer } from "react";

/** @final "over" */
export type LooseState = { step: "one" } | { step: "two" } | { step: "over" };

declare const external: any;

export function looseReducer(state: LooseState, event: "go"): LooseState {
  if (event === "go" && state.step === "one") return external;
  return { step: "over" };
}

export function useLoose() {
  return useReducer(looseReducer, { step: "one" });
}
