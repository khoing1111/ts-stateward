import { useReducer } from "react";

// Not a state machine: the state is a number.
function countReducer(count: number, step: number): number {
  return count + step;
}

export function useCount() {
  return useReducer(countReducer, 0);
}
