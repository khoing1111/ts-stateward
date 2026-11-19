import { watchPrices } from "./prices.js";

export function f(h: Headers, name: string): void {
  const stop = watchPrices(() => undefined);
  stop();
  h.set(name, "1");
}
