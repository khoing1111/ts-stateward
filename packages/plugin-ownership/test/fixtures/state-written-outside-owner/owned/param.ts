import type { Owned } from "./guarantees.js";

export function tweak(target: Owned<{ theme: string }>): void {
  target.theme = "x";
}
