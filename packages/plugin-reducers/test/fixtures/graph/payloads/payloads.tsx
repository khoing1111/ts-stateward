import { useReducer } from "react";
// A machine whose transitions return payloads typed as one state each: not a setter.
type S = { status: "idle" } | { status: "loading" } | { status: "done"; data: string } | { status: "verifying" };
type A =
  | { type: "start"; payload: { status: "loading" } }
  | { type: "finish"; payload: { status: "done"; data: string } };
function payloads(state: S, action: A): S {
  switch (action.type) {
    case "start": return state.status === "idle" ? action.payload : state;
    case "finish": return state.status === "loading" ? action.payload : state;
  }
}
export function Payloads() {
  const [s] = useReducer(payloads, { status: "idle" });
  return <p>{s.status}</p>;
}
