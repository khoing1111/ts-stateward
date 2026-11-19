import { watchPrices } from "./prices.js";
interface Cfg {
  readonly port: number;
}
class Live implements Cfg {
  get port(): number {
    throw new Error("x");
  }
}
export const cfg: Cfg = new Live();

export function f(): number {
  const stop = watchPrices(() => undefined);
  const n = cfg.port;
  stop();
  return n;
}
