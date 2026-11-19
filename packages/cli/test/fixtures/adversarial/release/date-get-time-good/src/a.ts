import { watchPrices } from "./prices.js";
export function f(d: Date): number { const stop = watchPrices(() => undefined); const t = d.getTime(); stop(); return t; }
