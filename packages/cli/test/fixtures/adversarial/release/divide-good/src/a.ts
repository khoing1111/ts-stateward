import { watchPrices } from "./prices.js";

export function f(a: number, b: number): number {
  const stop = watchPrices(() => undefined);
  const r = a / b;
  stop();
  return r;
}
