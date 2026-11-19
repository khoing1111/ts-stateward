import { watchPrices } from "./prices.js";

export function* follow(): Generator<number> {
  const stop = watchPrices(() => undefined);
  yield 1;
  stop();
}
