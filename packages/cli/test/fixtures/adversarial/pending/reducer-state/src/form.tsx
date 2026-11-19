import { useReducer, type ReactNode } from "react";
import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

type State = { status: Pending<"idle" | "saving", "saving"> };
type Event = { type: "start" } | { type: "done" };

function reducer(_state: State, event: Event): State {
  return event.type === "start" ? { status: "saving" } : { status: "idle" };
}

export function Editor(): ReactNode {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  async function save(): Promise<void> {
    if (state.status === "saving") return;
    dispatch({ type: "start" });
    await post();
    dispatch({ type: "done" });
  }

  return (
    <button disabled={state.status === "saving"} onClick={() => void save()}>
      save
    </button>
  );
}
