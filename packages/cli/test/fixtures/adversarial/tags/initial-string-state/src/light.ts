import { useReducer } from "react";

type Light = "red" | "green" | "yellow";
type LightEvent = { type: "next" } | { type: "reset" };

/** @initial "red" */
export function light(state: Light, event: LightEvent): Light {
  if (event.type === "reset") return "red";
  switch (state) {
    case "red":
      return "green";
    case "green":
      return "yellow";
    case "yellow":
      return "red";
  }
}

export function useLight() {
  return useReducer(light, "yellow");
}
