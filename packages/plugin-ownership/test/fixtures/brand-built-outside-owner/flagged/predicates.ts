import type { Positive } from "./values.js";
import type { Cents } from "./money.js";

export function isQty(value: number): value is Positive {
  return value > 0;
}

export function assertQty(value: number): asserts value is Positive {
  if (!(value > 0)) throw new Error("no");
}

export const isPrice = (value: number): value is Cents => value > 0;

export const guards = {
  isMaybeQty(value: unknown): value is Positive | undefined {
    return value === undefined;
  },
};

export type Check = (value: number) => value is Positive;
export const anonymous = [(value: number): value is Positive => value > 0];
