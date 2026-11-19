import { watchPrices } from "./prices.js";

function start() {
  return watchPrices(() => undefined);
}

export function follow(): void {
  start();
}
