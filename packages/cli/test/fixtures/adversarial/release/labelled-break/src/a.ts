import { watchPrices } from "./prices.js";

export function follow(skip: boolean): void {
  const stop = watchPrices(() => undefined);
  block: {
    if (skip) break block;
    stop();
  }
}
