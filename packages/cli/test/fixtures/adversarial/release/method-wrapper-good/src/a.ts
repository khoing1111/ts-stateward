import { watchPrices } from "./prices.js";

const api = { start: () => watchPrices(() => undefined) };

export function follow(): void {
  const stop = api.start();
  stop();
}
