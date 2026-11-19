import { positive, type Positive } from "./positive.js";

export function f(n: number): Positive | undefined {
  let p = positive(n);
  if (p === undefined) return undefined;
  p--;
  p--;
  return p;
}
