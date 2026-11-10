import { useReducer } from "react";

// Started as `undefined`: a known start, though which return runs on it is not read.
type Panel = { kind: "open" } | { kind: "closed" } | { kind: "pinned" } | undefined;

function panelReducer(state: Panel, action: "open" | "close"): Panel {
  if (action === "open") return { kind: "open" };
  return state?.kind === "open" ? { kind: "closed" } : state;
}

export function usePanel() {
  return useReducer(panelReducer, undefined);
}
