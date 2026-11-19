import { watchPrices } from "./prices.js";

export function f(t: string): void {
  const stop = watchPrices(() => undefined);
  try {
    JSON.parse(t);
    stop();
  } catch {
    console.log("bad");
  }
}
