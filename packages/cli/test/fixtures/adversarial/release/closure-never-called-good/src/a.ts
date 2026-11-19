import { watchPrices } from "./prices.js";

export function start(): void {
  const stop = watchPrices(() => undefined);
  const later = () => stop();
  later();
}
