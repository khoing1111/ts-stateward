import { settings } from "./settings.js";

function total<T>(xs: readonly T[], f: (x: T) => number): number {
  let sum = 0;
  for (const x of xs) sum += f(x);
  return sum;
}

export function g(): number {
  return total(settings.items, (i) => i.n);
}
