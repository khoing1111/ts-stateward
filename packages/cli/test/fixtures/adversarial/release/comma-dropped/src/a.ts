import { watchPrices } from "./prices.js";

export function follow(): number {
  return (watchPrices(() => undefined), 1);
}
