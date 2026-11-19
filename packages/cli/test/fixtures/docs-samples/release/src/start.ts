import { watchPrices } from "./prices";

export function start(): void {
  const stop = watchPrices(() => undefined);
}
