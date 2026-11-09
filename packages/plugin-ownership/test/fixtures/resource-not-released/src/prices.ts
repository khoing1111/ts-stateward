import type { Release } from "./guarantees";

export function watchPrices(onPrice: (price: number) => void): Release<() => void> {
  const id = setInterval(() => onPrice(Math.random()), 1000);
  return () => clearInterval(id);
}

// A module-level value lives as long as the program.
export const ticker = watchPrices(() => undefined);
