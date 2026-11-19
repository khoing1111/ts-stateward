import { watchPrices } from "./prices.js";

export function f(x: unknown): string {
  const stop = watchPrices(() => undefined);
  const s = String(x);
  stop();
  return s;
}
