import { watchPrices } from "./prices.js";

let stopAll: (() => void) | undefined;

export function start(): void {
  stopAll = watchPrices(() => undefined);
}

function stop(): void {
  stopAll?.();
}
void stop;
