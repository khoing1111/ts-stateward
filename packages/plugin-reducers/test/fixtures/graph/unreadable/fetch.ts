import { useReducer } from "react";

/** @final "done" */
export type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: string }
  | { status: "error"; message: string };

type FetchEvent =
  | { type: "start" }
  | { type: "ok"; data: string }
  | { type: "fail"; message: string }
  | { type: "reset" }
  | { type: "restore" };

declare function restore(): FetchState;

// Typed as the whole union, but its initializer says which state it is: read through it.
const initialState: FetchState = { status: "idle" };
// Its initializer is a call typed as the whole union: nothing to read through.
const restored: FetchState = restore();

function failed(message: string) {
  return { status: "error" as const, message };
}

function fetchReducer(state: FetchState, event: FetchEvent): FetchState {
  switch (event.type) {
    case "start":
      return { status: "loading" };
    case "ok":
      return { status: "done", data: event.data };
    case "fail":
      return failed(event.message);
    case "reset":
      return initialState;
    case "restore":
      return state.status === "error" ? restored : state;
  }
}

export function useFetch() {
  return useReducer(fetchReducer, initialState);
}
