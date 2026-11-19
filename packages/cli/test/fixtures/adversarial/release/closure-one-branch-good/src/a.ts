import { watchPrices } from "./prices.js";

export function start(): void {
  const stop = watchPrices(() => undefined);
  queueMicrotask(() => {
    stop();
  });
}
