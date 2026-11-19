import { watchPrices } from "./prices.js";

export function f(items: Iterable<number> | number[]): number {
  const stop = watchPrices(() => undefined);
  let t = 0;
  for (const i of items) t = t + i;
  stop();
  return t;
}
