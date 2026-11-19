import { watchPrices } from "./prices.js";

export function f(parts: string[]): string {
  const stop = watchPrices(() => undefined);
  const s = parts.join(",");
  stop();
  return s;
}
