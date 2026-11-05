import { useReducer } from "react";

/** @final "shipped" */
export type ParcelState = { stage: "packed" } | { stage: "shipped" };

// Exported from the package entry: code outside the project may call it, so it may start anywhere.
export function parcelReducer(state: ParcelState, event: "ship"): ParcelState {
  return event === "ship" && state.stage === "packed" ? { stage: "shipped" } : state;
}

export function useParcel() {
  return useReducer(parcelReducer, { stage: "packed" });
}
