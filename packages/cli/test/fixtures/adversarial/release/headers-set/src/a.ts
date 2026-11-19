import { watchPrices } from "./prices.js";

export function f(h: Headers, name: string): void {
  const stop = watchPrices(() => undefined);
  h.set(name, "1");
  stop();
}
