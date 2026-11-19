import { watchPrices } from "./prices.js";

export function follow(xs: number[]): void {
  const stop = watchPrices(() => undefined);
  for (const _x of xs) console.log(_x);
  stop();
}
