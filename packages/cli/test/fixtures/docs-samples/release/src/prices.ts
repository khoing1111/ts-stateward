import type { Release } from "./guarantees";

declare function read(): number;

export function watchPrices(onPrice: (price: number) => void): Release<() => void> {
  const id = setInterval(() => onPrice(read()), 1000);
  return () => clearInterval(id);
}
