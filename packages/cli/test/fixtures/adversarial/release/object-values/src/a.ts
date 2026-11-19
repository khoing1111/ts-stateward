import { watchPrices } from "./prices.js";

export function f(o: Record<string, number>): number {
  const stop = watchPrices(() => undefined);
  const v = Object.values(o);
  stop();
  return v.length;
}
