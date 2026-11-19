import { watchPrices } from "./prices.js";

export function start(): void {
  watchPrices(() => undefined);
}
