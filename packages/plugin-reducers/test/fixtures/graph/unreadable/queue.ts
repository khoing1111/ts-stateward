export type QueueState = { slot: "empty" } | { slot: "full" };

// Handed on, but never started with `useReducer` or `@initial`.
export function queueReducer(state: QueueState, event: "put" | "take"): QueueState {
  return event === "put" ? { slot: "full" } : state.slot === "full" ? { slot: "empty" } : state;
}

export const reducers = [queueReducer];
