import { useReducer } from "react";
import { light } from "./light.js";

export function useOtherLight() {
  return useReducer(light, { color: "red" });
}
