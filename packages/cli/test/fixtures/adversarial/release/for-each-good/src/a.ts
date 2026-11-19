import { watchPrices } from "./prices.js";

export function follow(xs: number[]): void {
  const stop = watchPrices(() => undefined);
  xs.forEach((x) => console.log(x));
  stop();
}
