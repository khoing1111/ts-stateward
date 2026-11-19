import { watchPrices } from "./prices.js";
export const m = new Map<string, number>();

export function f(k: string): number | undefined {
  const stop = watchPrices(() => undefined);
  const v = m.get(k);
  stop();
  return v;
}
