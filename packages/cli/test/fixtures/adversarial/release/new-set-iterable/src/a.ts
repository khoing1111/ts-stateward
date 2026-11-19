import { watchPrices } from "./prices.js";

export function f(items: Iterable<string>): number {
  const stop = watchPrices(() => undefined);
  const s = new Set(items);
  stop();
  return s.size;
}
