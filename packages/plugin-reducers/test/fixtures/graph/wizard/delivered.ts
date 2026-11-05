import { useReducer } from "react";

// Quoted states are read; the words after them are a comment.
/** @final "delivered" — the parcel arrived */
type Parcel = { leg: "sent" } | { leg: "delivered" };

function parcelReducer(state: Parcel, event: "arrive"): Parcel {
  return event === "arrive" && state.leg === "sent" ? { leg: "delivered" } : state;
}

export function useParcel() {
  return useReducer(parcelReducer, { leg: "sent" });
}
