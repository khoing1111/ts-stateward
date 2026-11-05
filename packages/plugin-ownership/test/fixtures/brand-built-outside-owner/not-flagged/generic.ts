import type { Positive } from "./values.js";

// A type parameter is not a brand declaration: nothing here names a brand being built.
export function widen<T extends Positive>(value: T): number {
  return value as number;
}
