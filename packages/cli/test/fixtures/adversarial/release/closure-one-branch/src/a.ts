import { watchPrices } from "./prices.js";

export function start(): void {
  const stop = watchPrices(() => undefined);
  queueMicrotask(() => {
    if (Math.random() > 0.5) stop();
  });
}
