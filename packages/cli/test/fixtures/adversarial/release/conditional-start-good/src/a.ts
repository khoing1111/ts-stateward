import { watchPrices } from "./prices.js";

export function start(on: boolean): void {
  const stop = on ? watchPrices(() => undefined) : undefined;
  stop?.();
}
