import { watchPrices } from "./prices.js";

export function follow(text: string): unknown {
  const stop = watchPrices(() => undefined);
  const value: unknown = JSON.parse(text);
  stop();
  return value;
}
