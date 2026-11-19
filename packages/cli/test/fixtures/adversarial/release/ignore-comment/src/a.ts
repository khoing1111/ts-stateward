import { watchPrices } from "./prices.js";

export function start(): void {
  // stateward-ignore ownership/resource-not-released: lives as long as the app
  watchPrices(() => undefined);
}
