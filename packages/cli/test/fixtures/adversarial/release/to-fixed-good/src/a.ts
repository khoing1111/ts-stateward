import { watchPrices } from "./prices.js";
export function f(n: number): string { const stop = watchPrices(() => undefined); const s = n.toFixed(2); stop(); return s; }
