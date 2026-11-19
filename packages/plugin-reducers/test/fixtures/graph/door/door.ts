import { useReducer } from "react";

export type DoorState = { kind: "open" } | { kind: "closed" } | { kind: "locked" };
export type DoorEvent = { type: "close" } | { type: "lock" };

export function door(state: DoorState, event: DoorEvent): DoorState {
  if (state.kind === "open" && event.type === "close") return { kind: "closed" };
  if (state.kind === "closed" && event.type === "lock") return { kind: "locked" };
  return state;
}

export function useDoor() {
  return useReducer(door, { kind: "open" });
}
