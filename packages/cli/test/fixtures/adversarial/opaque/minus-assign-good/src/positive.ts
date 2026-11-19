import type { Opaque } from "./guarantees.js";

export type Positive = Opaque<number, "Positive">;

export function positive(n: number): Positive | undefined {
  return n > 0 ? n : undefined;
}
