import { watchPrices } from "./prices.js";
import type { Owned } from "./guarantees.js";

export const holder: { stop: Owned<() => void> | undefined } = { stop: undefined };

export function start(): void {
  holder.stop = watchPrices(() => undefined);
}
