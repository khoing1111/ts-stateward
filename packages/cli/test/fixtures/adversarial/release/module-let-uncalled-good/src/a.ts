import { watchPrices } from "./prices.js";

let stopAll: (() => void) | undefined;

export function start(): void {
  stopAll = watchPrices(() => undefined);
}

export function stop(): void {
  stopAll?.();
}
