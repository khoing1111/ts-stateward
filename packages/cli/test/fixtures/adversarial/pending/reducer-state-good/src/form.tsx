import { useReducer, useState, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

type State = { saved: number };
type Event = { type: "done" };

function reducer(state: State, _event: Event): State {
  return { saved: state.saved + 1 };
}

export function Editor(): ReactNode {
  const [status, setStatus] = useState<Pending<"idle" | "saving", "saving">>("idle");
  const [state, dispatch] = useReducer(reducer, { saved: 0 });
  async function save(): Promise<void> {
    setStatus("saving");
    try {
      await post();
      dispatch({ type: "done" });
    } finally {
      setStatus("idle");
    }
  }

  return (
    <button disabled={status === "saving"} onClick={() => void save()}>
      save {state.saved}
    </button>
  );
}
