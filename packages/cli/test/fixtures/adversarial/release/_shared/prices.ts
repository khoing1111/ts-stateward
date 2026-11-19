import type { Release } from "./guarantees.js";

export function watchPrices(onPrice: (price: number) => void): Release<() => void> {
  const id = setInterval(() => onPrice(1), 1000);
  return () => clearInterval(id);
}
