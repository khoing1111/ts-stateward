import { watchPrices } from "./prices.js";

export function start(): void {
  [1, 2].map(() => watchPrices(() => undefined));
}
