import { watchPrices } from "./prices.js";

export function f(xs: number[]): number {
  const stop = watchPrices(() => undefined);
  const t = xs.reduce((s, x) => s + x, 0);
  stop();
  return t;
}
