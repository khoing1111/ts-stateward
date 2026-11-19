import { watchPrices } from "./prices.js";

export function f(e: unknown): boolean {
  const stop = watchPrices(() => undefined);
  const ok = e instanceof Error;
  stop();
  return ok;
}
