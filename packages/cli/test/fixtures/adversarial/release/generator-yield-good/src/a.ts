import { watchPrices } from "./prices.js";

export function* follow(): Generator<number> {
  const stop = watchPrices(() => undefined);
  try {
    yield 1;
  } finally {
    stop();
  }
}
