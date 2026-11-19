import { positive, type Positive } from "./positive.js";

export function f(n: number): Positive | undefined {
  const p = positive(n);
  if (p === undefined) return undefined;
  return positive(p - 100);
}
