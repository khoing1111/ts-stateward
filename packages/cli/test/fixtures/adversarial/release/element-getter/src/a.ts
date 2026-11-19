import { watchPrices } from "./prices.js";
class Cfg {
  get port(): number {
    throw new Error("x");
  }
}
export const cfg = new Cfg();

export function f(): number {
  const stop = watchPrices(() => undefined);
  const n = cfg["port"];
  stop();
  return n;
}
