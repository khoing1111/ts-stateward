import { watchPrices } from "./prices.js";

export function f(o: object): unknown {
  const stop = watchPrices(() => undefined);
  const v: unknown = Reflect.get(o, "port");
  stop();
  return v;
}
