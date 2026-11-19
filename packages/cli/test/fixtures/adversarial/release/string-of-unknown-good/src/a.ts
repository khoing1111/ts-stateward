import { watchPrices } from "./prices.js";

export function f(x: number): string {
  const stop = watchPrices(() => undefined);
  const s = String(x);
  stop();
  return s;
}
