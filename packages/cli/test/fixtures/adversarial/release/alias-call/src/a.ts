import { watchPrices } from "./prices.js";

const w = watchPrices;

export function start(): void {
  w(() => undefined);
}
