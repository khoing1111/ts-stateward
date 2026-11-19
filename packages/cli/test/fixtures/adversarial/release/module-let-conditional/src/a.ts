import { watchPrices } from "./prices.js";

let stopAll: (() => void) | undefined;

export function start(): void {
  stopAll = watchPrices(() => undefined);
}

export function stop(now: boolean): void {
  if (now) stopAll?.();
}
