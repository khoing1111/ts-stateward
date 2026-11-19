import { watchPrices } from "./prices.js";

export function f(xs: number[]): number[] {
  const stop = watchPrices(() => undefined);
  const s = [...xs];
  stop();
  return s;
}
