import { watchPrices } from "./prices.js";

export function f(x: unknown): number {
  const stop = watchPrices(() => undefined);
  const n = Number(x);
  stop();
  return n;
}
