import { useReducer } from "react";

export type Light = { color: "red" } | { color: "green" } | { color: "yellow" };
export type LightEvent = { type: "next" };

/** @initial "red" */
export function light(state: Light, _event: LightEvent): Light {
  switch (state.color) {
    case "red":
      return { color: "green" };
    case "green":
      return { color: "yellow" };
    case "yellow":
      return { color: "red" };
  }
}

const start: Light = { color: "red" };

export function useLight() {
  return useReducer(light, start);
}
