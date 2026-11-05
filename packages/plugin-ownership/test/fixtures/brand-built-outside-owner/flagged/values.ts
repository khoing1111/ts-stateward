import type { Brand } from "./brand.js";

// The project's checked values: this file owns them.
export type Positive = Brand<number, "Positive">;
export type NonNegative = Brand<number, "NonNegative">;
export type Int = Brand<number, "Int">;
export type NonEmptyString = Brand<string, "NonEmptyString">;
export type NonEmptyArray<T> = Brand<readonly [T, ...T[]], "NonEmptyArray">;

export function positive(value: number): Positive | undefined {
  return value > 0 ? (value as Positive) : undefined;
}

// Each brand's check, in every shape a constructor takes: a predicate, an assertion, an arrow.
export function isNonNegative(value: number): value is NonNegative {
  return value >= 0;
}

export function assertInt(value: number): asserts value is Int {
  if (!Number.isInteger(value)) throw new Error(`${String(value)} is not an integer`);
}

export const nonEmptyString = (text: string): NonEmptyString | undefined =>
  text === "" ? undefined : (text as NonEmptyString);

export function nonEmptyArray<T>(items: readonly T[]): NonEmptyArray<T> | undefined {
  return items.length > 0 ? (items as NonEmptyArray<T>) : undefined;
}
