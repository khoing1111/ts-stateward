import { watchPrices } from "./prices.js";

export function f(n: number, base: number): string {
  const stop = watchPrices(() => undefined);
  const s = n.toString(base);
  stop();
  return s;
}
