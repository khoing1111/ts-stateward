import { watchPrices } from "./prices.js";

export function f(p: { id: string; n: number }): number {
  const stop = watchPrices(() => undefined);
  const { n } = p;
  stop();
  return n;
}
