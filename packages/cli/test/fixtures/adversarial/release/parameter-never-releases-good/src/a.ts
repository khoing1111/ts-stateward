import { watchPrices } from "./prices.js";
import type { Release } from "./guarantees.js";

export function keep(stop: Release<() => void>): void {
  stop();
}

export function start(): void {
  keep(watchPrices(() => undefined));
}
