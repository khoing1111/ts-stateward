import { watchPrices } from "./prices.js";
import type { Release } from "./guarantees.js";

export function keep(...stops: Array<Release<() => void>>): void {
  stops.length = 0;
}

export function start(): void {
  keep(watchPrices(() => undefined));
}
