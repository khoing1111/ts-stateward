import { watchPrices } from "./prices.js";
class Cfg {
  readonly port = 1;
}
export const cfg: Cfg = new Cfg();

export function f(): number {
  const stop = watchPrices(() => undefined);
  const n = cfg.port;
  stop();
  return n;
}
