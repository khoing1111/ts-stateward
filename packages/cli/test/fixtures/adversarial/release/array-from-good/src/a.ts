import { watchPrices } from "./prices.js";
export function f(xs: string[]): string[] { const stop = watchPrices(() => undefined); const ys = Array.from(xs); stop(); return ys; }
