import { watchPrices } from "./prices.js";

export function follow(done: Promise<void>): void {
  const stop = watchPrices(() => undefined);
  void done.then(() => stop());
}
