import { watchPrices } from "./prices.js";

export function start(): () => void {
  const a = watchPrices(() => undefined);
  const b = watchPrices(() => undefined);
  return () => {
    a();
    b();
  };
}
