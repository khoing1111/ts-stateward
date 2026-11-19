import { watchPrices } from "./prices.js";

export function f(n: number): string {
  const stop = watchPrices(() => undefined);
  const s = n.toString();
  stop();
  return s;
}
