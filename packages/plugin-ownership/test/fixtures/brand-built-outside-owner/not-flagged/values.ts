import type { Brand } from "./brand.js";

export type Positive = Brand<number, "Positive">;

/** The checking function lives with the brand: its cast is the owner's. */
export function positive(value: number): Positive | undefined {
  return value > 0 ? (value as Positive) : undefined;
}

/** A hand-written brand with a unique-symbol key. */
declare const percent: unique symbol;
export type Percent = number & { readonly [percent]: true };

export function toPercent(value: number): Percent | undefined {
  return value >= 0 && value <= 100 ? (value as Percent) : undefined;
}
