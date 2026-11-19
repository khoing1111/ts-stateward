import { watchPrices } from "./prices.js";

export function f(items: number[]): number {
  const stop = watchPrices(() => undefined);
  let t = 0;
  for (const i of items) t = t + i;
  stop();
  return t;
}
