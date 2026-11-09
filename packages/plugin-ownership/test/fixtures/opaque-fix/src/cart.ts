import type { Positive } from "./values.js";

export function quantity(input: { qty: number }): Positive {
  return input.qty as Positive;
}
