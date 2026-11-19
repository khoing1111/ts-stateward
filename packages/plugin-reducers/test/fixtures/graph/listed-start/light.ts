import { useReducer } from "react";

type Light = { color: "red" } | { color: "green" } | { color: "yellow" };
type Event = { type: "next" } | { type: "reset" };

/** @initial "red" */
export function light(state: Light, event: Event): Light {
  if (event.type === "reset") return { color: "red" };
  switch (state.color) {
    case "red":
      return { color: "green" };
    case "green":
      return { color: "yellow" };
    case "yellow":
      return { color: "red" };
  }
}

export function useLight() {
  return useReducer(light, { color: "yellow" });
}
