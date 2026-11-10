import { useReducer } from "react";

// A selection that can be empty, started empty: `null` is a known start. It builds a state of its
// own (`ALL`), so it is a state machine, and its `return action.payload` is still reported.
type Selection = { kind: "nodes"; ids: string[] } | { kind: "edges"; ids: string[] } | null;
type SelectionAction = { type: "SET"; payload: Selection } | { type: "ALL" } | { type: "CLEAR" };

function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "SET":
      return action.payload;
    case "ALL":
      return { kind: "nodes", ids: [] };
    case "CLEAR":
      return null;
  }
}

export function Page() {
  const [selected, dispatch] = useReducer(selectionReducer, null);
  return <button onClick={() => dispatch({ type: "CLEAR" })}>{selected?.ids.length}</button>;
}

function emptySelection(): Selection {
  return null;
}

// The same start through an `init` function.
export function usePicked() {
  return useReducer(selectionReducer, undefined, emptySelection);
}
