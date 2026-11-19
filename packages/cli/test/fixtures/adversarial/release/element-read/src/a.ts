import { watchPrices } from "./prices.js";

export function f(items: string[]): number {
  const stop = watchPrices(() => undefined);
  const n = items[0].length;
  stop();
  return n;
}
