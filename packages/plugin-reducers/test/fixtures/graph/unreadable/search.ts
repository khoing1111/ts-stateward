import { useReducer } from "react";

/** @final "found" */
export type SearchState = { mode: "idle" } | { mode: "searching" } | { mode: "found" };

export function searchReducer(state: SearchState, event: "go" | "hit"): SearchState {
  if (event === "go") return { mode: "searching" };
  return state.mode === "searching" ? { mode: "found" } : state;
}

export function useSearch() {
  return useReducer(searchReducer, { mode: "idle" });
}

// Called directly too: the reducer may start in any state.
export function runTwice(state: SearchState): SearchState {
  return searchReducer(searchReducer(state, "go"), "hit");
}
