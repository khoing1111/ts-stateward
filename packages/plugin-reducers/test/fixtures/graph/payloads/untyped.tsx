import { useReducer } from "react";
// The payload is `any`: it says nothing about the state, so the reducer is not a setter.
type S = { status: "idle" } | { status: "done" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = { type: "set"; payload: any } | { type: "reset" };
function untyped(state: S, action: A): S {
  switch (action.type) {
    case "set":
      return action.payload;
    case "reset":
      return state;
  }
}
export function Untyped() {
  const [s] = useReducer(untyped, { status: "idle" });
  return <p>{s.status}</p>;
}
