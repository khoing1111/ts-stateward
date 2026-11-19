import { watchPrices } from "./prices.js";

export function f(x: number): boolean {
  const stop = watchPrices(() => undefined);
  const ok = Number.isFinite(x);
  stop();
  return ok;
}
