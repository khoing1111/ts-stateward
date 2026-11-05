import { useReducer } from "react";

/** @final "stopped" */
type Light = { color: "green" } | { color: "yellow" } | { color: "red" } | { color: "stopped" };

// Reachable through every path; starts typed as the whole union are checked by `readable-reducer`.
function lightReducer(state: Light, event: "next" | "stop"): Light {
  if (event === "stop") return { color: "stopped" };
  switch (state.color) {
    case "green":
      return { color: "yellow" };
    case "yellow":
      return { color: "red" };
    case "red":
      return { color: "green" };
    case "stopped":
      return state;
  }
}

export function useLight() {
  return useReducer(lightReducer, { color: "green" });
}
