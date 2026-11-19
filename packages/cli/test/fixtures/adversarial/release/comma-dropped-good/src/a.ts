import { watchPrices } from "./prices.js";

export function follow(): number {
  const stop = watchPrices(() => undefined);
  stop();
  return 1;
}
