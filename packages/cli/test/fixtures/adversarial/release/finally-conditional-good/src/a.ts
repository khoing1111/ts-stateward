import { watchPrices } from "./prices.js";

export function start(work: () => void): void {
  const stop = watchPrices(() => undefined);
  try {
    work();
  } finally {
    stop();
  }
}
