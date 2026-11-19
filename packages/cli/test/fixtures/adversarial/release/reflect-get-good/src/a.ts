import { watchPrices } from "./prices.js";

export function f(o: object): unknown {
  const stop = watchPrices(() => undefined);
  stop();
  return Reflect.get(o, "port");
}
