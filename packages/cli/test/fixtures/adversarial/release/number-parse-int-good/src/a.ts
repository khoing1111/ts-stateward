import { watchPrices } from "./prices.js";
export function f(s: string): number { const stop = watchPrices(() => undefined); const n = Number.parseInt(s, 10); stop(); return n; }
