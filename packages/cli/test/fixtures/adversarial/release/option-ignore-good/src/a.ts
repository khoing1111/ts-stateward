import { watchPrices } from "./prices.js";

export function start(): () => void {
  return watchPrices(() => undefined);
}
