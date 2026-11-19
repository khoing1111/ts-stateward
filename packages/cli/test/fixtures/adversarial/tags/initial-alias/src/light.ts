import { useReducer } from "react";

export type Light = { color: "red" } | { color: "green" } | { color: "yellow" };
export type LightEvent = { type: "next" } | { type: "reset" };

/** @initial "red" */
export function light(state: Light, event: LightEvent): Light {
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

const reducer = light;

export function useLight() {
  return useReducer(reducer, { color: "yellow" });
}
