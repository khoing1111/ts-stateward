import { useReducer } from "react";

/** @final "nodes" | "edges" */
type Selection = { kind: "nodes"; ids: string[] } | { kind: "edges"; ids: string[] } | null;
type SelectionAction = { type: "SET"; payload: Selection } | { type: "CLEAR" };

function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "SET":
      return state;
    case "CLEAR":
      return state;
  }
}

// A start of the state type, from data: any state may come first.
export function useSaved(saved: Selection) {
  return useReducer(selectionReducer, saved);
}

/** @final "list" | "grid" */
type Tab = { kind: "list" } | { kind: "grid" };

function tabReducer(state: Tab, action: "toggle"): Tab {
  return action === "toggle" ? state : state;
}

// `null` is no state of `Tab`.
export function useTab() {
  return useReducer(tabReducer, null);
}
