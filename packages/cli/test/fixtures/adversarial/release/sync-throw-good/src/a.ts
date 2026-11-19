import { watchPrices } from "./prices.js";

export function follow(text: string, count: number): unknown {
  const stop = watchPrices(() => undefined);
  const label = `${text}: ${String(count)}`;
  const more = count > 1 && label !== "";
  console.log(label, more, typeof text);
  stop();
  return { label, more };
}
