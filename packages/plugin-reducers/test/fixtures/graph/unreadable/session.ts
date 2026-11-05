import { useReducer } from "react";

/** @final "closed" */
export type SessionState = { phase: "open" } | { phase: "idle" } | { phase: "closed" };

export function sessionReducer(state: SessionState, event: "idle" | "close"): SessionState {
  if (event === "close") return { phase: "closed" };
  return state.phase === "open" ? { phase: "idle" } : state;
}

// Starts from data the program does not know: any state may come first.
export function useSession(saved: SessionState) {
  return useReducer(sessionReducer, saved);
}
