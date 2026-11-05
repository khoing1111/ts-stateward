import { assertNever } from "./helper.js";

type Mode = "r" | "w" | "x";

// The file already imports `assertNever`: the hint does not say where it comes from.
export function read(mode: Mode): number {
  if (mode === "r") {
    return 1;
  } else if (mode === "w") {
    return 2;
  }
  return assertNever === undefined ? 0 : 3;
}
