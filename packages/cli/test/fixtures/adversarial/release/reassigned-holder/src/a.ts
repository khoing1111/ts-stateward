import { watchPrices } from "./prices.js";

export function start(): void {
  let stop = watchPrices(() => undefined);
  stop = () => undefined;
  stop();
}
