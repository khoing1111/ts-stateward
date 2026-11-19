import { watchPrices } from "./prices.js";

export function f(i: number): boolean {
  const stop = watchPrices(() => undefined);
  const even = i % 2 === 0;
  stop();
  return even;
}
