import { watchPrices } from "./prices.js";

export function f(parts: unknown[]): string {
  const stop = watchPrices(() => undefined);
  const s = parts.join(",");
  stop();
  return s;
}
