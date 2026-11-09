import * as everything from "./namespace-index.js";

export function useAll(): number {
  // The whole namespace goes to code that could change what is in it.
  return Object.values(everything).length;
}
