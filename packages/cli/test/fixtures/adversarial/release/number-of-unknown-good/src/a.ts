import { watchPrices } from "./prices.js";

export function f(x: string): number {
  const stop = watchPrices(() => undefined);
  const n = Number(x);
  stop();
  return n;
}
