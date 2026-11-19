import { watchPrices } from "./prices.js";

export function f(items: string[]): number {
  const stop = watchPrices(() => undefined);
  const first = items.at(0);
  stop();
  return first?.length ?? 0;
}
