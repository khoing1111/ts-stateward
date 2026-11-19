import { watchPrices } from "./prices.js";

export function follow(n: number): void {
  const stop = watchPrices(() => undefined);
  let i = 0;
  do {
    i++;
  } while (i < n);
  stop();
}
