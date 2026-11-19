import { watchPrices } from "./prices.js";

export function f(t: string): unknown {
  const stop = watchPrices(() => undefined);
  try {
    const v: unknown = JSON.parse(t);
    stop();
    return v;
  } catch {
    return undefined;
  }
}
