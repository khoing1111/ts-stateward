import { useReducer } from "react";

// A setter, not a state machine: each case sets what the action carries, empties the state or
// keeps it. Its states follow from what the caller sends, so there is no graph to check.
type Selection = { kind: "nodes"; ids: string[] } | { kind: "edges"; ids: string[] } | null;
type SelectionAction =
  | { type: "SET"; payload: Selection }
  | { type: "CLEAR" }
  | { type: "KEEP" }
  | { type: "PICK"; value: Selection; keep: boolean };

const EMPTY = null;

function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "SET":
      return action.payload;
    case "CLEAR":
      return EMPTY;
    case "KEEP":
      return state;
    case "PICK":
      return action.keep ? state : action.value;
  }
}

export function Page() {
  const [selected, dispatch] = useReducer(selectionReducer, null);
  return <button onClick={() => dispatch({ type: "CLEAR" })}>{selected?.ids.length}</button>;
}

type Tab = { kind: "list" } | { kind: "grid" };
type TabAction = { type: "SET"; tab: Tab } | { type: "RESET" };

const initialTab: Tab = { kind: "list" };

function tabReducer(state: Tab = initialTab, action: TabAction): Tab {
  return action.type === "SET" ? action.tab : state;
}

// Started from data: a setter is not read, so the start is not reported either.
export function useTab(saved: Tab) {
  return useReducer(tabReducer, saved);
}
