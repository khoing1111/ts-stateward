import { watchPrices } from "./prices.js";

export function f(el: HTMLElement, cls: string): void {
  const stop = watchPrices(() => undefined);
  el.classList.add(cls);
  stop();
}
