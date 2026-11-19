import { watchPrices } from "./prices.js";
import type { Release } from "./guarantees.js";

export function keep(_stop: Release<() => void>): void {
  // never released
}

export function start(): void {
  keep(watchPrices(() => undefined));
}
